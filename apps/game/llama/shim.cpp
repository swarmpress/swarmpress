// The browser face of upstream llama.cpp (ADR-0066): load a GGUF target and,
// optionally, its MTP drafter, then stream one chat turn with or without
// speculative decoding. The generation loop follows upstream's
// examples/speculative-simple; nothing here touches tensors.
//
// Exports are called from a Dedicated Worker through JSPI: a call that waits on
// the GPU suspends, so the Worker's message handler can run in between (that is
// how a stop request reaches the loop, through sp_should_stop).

#include "chat.h"
#include "common.h"
#include "llama.h"
#include "sampling.h"
#include "speculative.h"

#include <emscripten.h>

#include <algorithm>
#include <exception>
#include <cstdio>
#include <string>
#include <vector>

EM_JS(void, sp_emit, (const char * text, int len), {
    if (Module.onPiece) Module.onPiece(UTF8ToString(Number(text), len));  // wasm64 passes pointers as BigInt
});

EM_JS(int, sp_should_stop, (), {
    return Module.stopRequested ? 1 : 0;
});

namespace {

common_params g_params;
common_init_result_ptr g_init;
common_speculative_init_result_ptr g_spec_init;
llama_model * g_model = nullptr;
llama_context * g_ctx = nullptr;
llama_context * g_ctx_dft = nullptr;
common_chat_templates_ptr g_templates;
std::string g_result;

std::string json_escape(const std::string & s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += (char) c;
                }
        }
    }
    return out;
}

const char * fail(const std::string & message) {
    g_result = "{\"ok\":false,\"error\":\"" + json_escape(message) + "\"}";
    return g_result.c_str();
}

void emit(const std::string & piece) {
    if (!piece.empty()) sp_emit(piece.data(), (int) piece.size());
}

}  // namespace

extern "C" {

// Loads the target (and the drafter when draft_path is not empty). Returns a JSON status.
static const char * sp_load_impl(const char * target_path, const char * draft_path, int n_ctx, int n_draft_max) {
    if (g_model) return fail("a model is already loaded");

    common_params params;
    params.model.path = target_path;
    params.n_ctx = n_ctx;
    params.n_batch = 2048;
    params.n_ubatch = 512;
    params.n_gpu_layers = 999;
    params.fit_params = false;
    params.load_mode = LLAMA_LOAD_MODE_NONE;  // no mmap in the browser: tensors are read and uploaded one by one
    params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;  // Unsloth's MTP recipe runs with -fa off
    params.cpuparams.n_threads = 1;  // the CPU backend only gathers the per-layer embeddings
    params.cpuparams_batch.n_threads = 1;
    params.sampling.temp = 0.0f;  // greedy: the same tokens with and without the drafter

    const bool with_draft = draft_path && draft_path[0];
    if (with_draft) {
        params.speculative.types = { COMMON_SPECULATIVE_TYPE_DRAFT_MTP };
        params.speculative.draft.mparams.path = draft_path;
        params.speculative.draft.n_max = n_draft_max;
        params.speculative.draft.n_gpu_layers = 999;
        params.speculative.draft.cpuparams.n_threads = 1;
        params.speculative.draft.cpuparams_batch.n_threads = 1;
    }

    const auto limits = common_speculative_get_output_limits(params.n_batch, params.n_parallel, common_speculative_n_max(&params.speculative));
    params.n_outputs_max = limits.total;
    params.n_outputs_max_per_seq = limits.per_seq;

    llama_backend_init();

    fprintf(stderr, "sp_load: loading the target\n");
    g_init = common_init_from_params(params);
    g_model = g_init->model();
    g_ctx = g_init->context();
    if (!g_model || !g_ctx) {
        g_init.reset();
        g_model = nullptr;
        g_ctx = nullptr;
        return fail("failed to load the target model");
    }

    if (with_draft) {
        fprintf(stderr, "sp_load: loading the MTP drafter\n");
        common_params params_dft = common_base_params_to_speculative(params);
        g_spec_init = common_speculative_init_from_params(params_dft, g_model, g_ctx);
        params.speculative.draft.ctx_tgt = g_ctx;
        params.speculative.draft.ctx_dft = g_spec_init->context();
        g_ctx_dft = params.speculative.draft.ctx_dft;
        if (!g_ctx_dft) return fail("failed to load the MTP drafter");
    }

    fprintf(stderr, "sp_load: chat templates\n");
    g_templates = common_chat_templates_init(g_model, "");
    g_params = params;

    char desc[256];
    llama_model_desc(g_model, desc, sizeof desc);
    g_result = std::string("{\"ok\":true,\"model\":\"") + json_escape(desc) + "\",\"n_ctx\":" + std::to_string(llama_n_ctx(g_ctx)) +
               ",\"params\":" + std::to_string(llama_model_n_params(g_model)) + ",\"size\":" + std::to_string(llama_model_size(g_model)) +
               ",\"draft\":" + (g_ctx_dft ? "true" : "false") + "}";
    return g_result.c_str();
}

// Streams one user turn through sp_emit. use_mtp=0 decodes token by token on the target alone.
static const char * sp_generate_impl(const char * user_text, int n_predict, int use_mtp, int enable_thinking) {
    if (!g_model) return fail("no model loaded");
    if (use_mtp && !g_ctx_dft) return fail("no MTP drafter loaded");

    const llama_vocab * vocab = llama_model_get_vocab(g_model);
    const llama_seq_id seq_id = 0;

    llama_memory_clear(llama_get_memory(g_ctx), true);
    if (g_ctx_dft) llama_memory_clear(llama_get_memory(g_ctx_dft), true);

    common_chat_templates_inputs inputs;
    common_chat_msg msg;
    msg.role = "user";
    msg.content = user_text;
    inputs.messages.push_back(msg);
    inputs.enable_thinking = enable_thinking != 0;
    const std::string prompt = common_chat_templates_apply(g_templates.get(), inputs).prompt;

    std::vector<llama_token> inp = common_tokenize(g_ctx, prompt, true, true);
    if (inp.size() < 2) return fail("empty prompt");
    if ((uint32_t) inp.size() + (uint32_t) n_predict + 8 > llama_n_ctx(g_ctx)) return fail("prompt and answer exceed the context");
    if ((uint32_t) inp.size() > llama_n_batch(g_ctx)) return fail("prompt exceeds the batch size");

    common_sampler_ptr smpl(common_sampler_init(g_model, g_params.sampling));

    const double t0 = emscripten_get_now();
    int n_predicted = 0, n_drafted = 0, n_accepted = 0, n_target_steps = 0;
    bool stopped = false;
    double t_first = 0;

    if (!use_mtp) {
        common_batch batch(g_ctx);
        for (size_t i = 0; i < inp.size(); ++i) batch.add(inp[i], (llama_pos) i, seq_id, i + 1 == inp.size());
        if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch.get()) != 0) return fail("prefill failed");
        llama_pos n_past = (llama_pos) inp.size();
        while (n_predicted < n_predict) {
            const llama_token id = common_sampler_sample(smpl.get(), g_ctx, -1);
            common_sampler_accept(smpl.get(), id, true);
            ++n_target_steps;
            if (n_predicted == 0) t_first = emscripten_get_now();
            ++n_predicted;
            if (llama_vocab_is_eog(vocab, id)) break;
            emit(common_token_to_piece(g_ctx, id));
            if (sp_should_stop()) { stopped = true; break; }
            batch.clear();
            batch.add(id, n_past++, seq_id, true);
            if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch.get()) != 0) return fail("decode failed");
        }
    } else {
        // examples/speculative-simple, for one sequence.
        common_speculative * spec = common_speculative_init(g_params.speculative, 1);
        if (!spec) return fail("failed to initialize MTP");
        const bool use_ckpt_tgt = common_context_can_seq_rm(g_ctx) == COMMON_CONTEXT_SEQ_RM_TYPE_FULL;
        const bool use_ckpt_dft = common_context_can_seq_rm(g_ctx_dft) == COMMON_CONTEXT_SEQ_RM_TYPE_FULL;

        {
            common_batch batch_prompt(g_ctx);
            for (size_t i = 0; i + 1 < inp.size(); ++i) batch_prompt.add(inp[i], (llama_pos) i, seq_id, false);
            if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch_prompt.get()) != 0) { common_speculative_free(spec); return fail("prefill failed"); }
            if (!common_speculative_process(spec, batch_prompt)) { common_speculative_free(spec); return fail("MTP prefill failed"); }
        }

        llama_token id_last = inp.back();
        llama_tokens prompt_tgt(inp.begin(), inp.end() - 1);
        prompt_tgt.reserve(llama_n_ctx(g_ctx));
        int n_past = (int) inp.size() - 1;
        common_speculative_begin(spec, seq_id, prompt_tgt);

        common_batch batch_tgt(g_ctx);
        llama_tokens draft;
        common_prompt_checkpoint ckpt;
        bool done = false;

        while (!done) {
            if (draft.empty()) {
                ckpt.update_pos(prompt_tgt.size(), llama_memory_seq_pos_min(llama_get_memory(g_ctx), seq_id),
                                llama_memory_seq_pos_max(llama_get_memory(g_ctx), seq_id));
                if (use_ckpt_dft) ckpt.update_dft(g_ctx_dft, seq_id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);

                int n_draft_max = std::min((int) llama_n_ctx(g_ctx) - n_past - 2, n_predict - n_predicted - 1);
                n_draft_max = std::max(n_draft_max, 0);
                common_speculative_get_draft_params(spec, seq_id) = {
                    /* .drafting = */ true,
                    /* .n_max    = */ n_draft_max,
                    /* .pos0     = */ n_past,
                    /* .id_last  = */ id_last,
                    /* .prompt   = */ &prompt_tgt,
                    /* .result   = */ &draft,
                };
                common_speculative_draft(spec);

                if (!draft.empty() && use_ckpt_tgt) ckpt.update_tgt(g_ctx, seq_id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
                if (use_ckpt_dft) ckpt.load_dft(g_ctx_dft, seq_id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
                llama_memory_seq_rm(llama_get_memory(g_ctx_dft), seq_id, ckpt.pos_max + 1, -1);
            }

            batch_tgt.clear();
            batch_tgt.add(id_last, n_past++, seq_id, true);
            for (size_t i = 0; i < draft.size(); ++i) batch_tgt.add(draft[i], n_past + (llama_pos) i, seq_id, true);
            if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch_tgt.get()) != 0) { common_speculative_free(spec); return fail("decode failed"); }
            ++n_target_steps;
            if (!common_speculative_process(spec, batch_tgt)) { common_speculative_free(spec); return fail("MTP step failed"); }

            common_sampler_ptr smpl_save;
            if (use_ckpt_tgt) smpl_save.reset(common_sampler_clone(smpl.get()));
            const size_t n_draft = draft.size();
            auto ids = common_sampler_sample_and_accept_n(smpl.get(), g_ctx, draft);

            if (use_ckpt_tgt && ids.size() - 1 < n_draft) {
                draft = std::move(ids);
                ckpt.load_tgt(g_ctx, seq_id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
                llama_memory_seq_rm(llama_get_memory(g_ctx), seq_id, ckpt.pos_max + 1, -1);
                ckpt.load_dft(g_ctx_dft, seq_id, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
                llama_memory_seq_rm(llama_get_memory(g_ctx_dft), seq_id, ckpt.pos_max + 1, -1);
                prompt_tgt.resize(ckpt.n_tokens);
                smpl = std::move(smpl_save);
                n_past = (int) prompt_tgt.size();
                continue;
            }

            common_speculative_accept(spec, seq_id, (uint16_t) (ids.size() - 1));
            n_past += (int) ids.size() - 1;
            n_drafted += (int) n_draft;
            n_accepted += (int) ids.size() - 1;
            if (n_predicted == 0) t_first = emscripten_get_now();
            n_predicted += (int) ids.size();

            for (size_t i = 0; i < ids.size(); ++i) {
                prompt_tgt.push_back(id_last);
                id_last = ids[i];
                if (llama_vocab_is_eog(vocab, id_last)) { done = true; break; }
                emit(common_token_to_piece(g_ctx, id_last));
            }
            draft.clear();
            llama_memory_seq_rm(llama_get_memory(g_ctx), seq_id, n_past, -1);
            llama_memory_seq_rm(llama_get_memory(g_ctx_dft), seq_id, n_past, -1);

            if (n_predicted >= n_predict) done = true;
            if (sp_should_stop()) { stopped = true; done = true; }
        }
        common_speculative_free(spec);
    }

    const double t1 = emscripten_get_now();
    const double decode_ms = t_first > 0 ? t1 - t_first : 0;
    g_result = "{\"ok\":true,\"promptTokens\":" + std::to_string(inp.size()) + ",\"tokens\":" + std::to_string(n_predicted) +
               ",\"targetSteps\":" + std::to_string(n_target_steps) + ",\"drafted\":" + std::to_string(n_drafted) +
               ",\"accepted\":" + std::to_string(n_accepted) + ",\"ttftMs\":" + std::to_string(t_first > 0 ? t_first - t0 : 0) +
               ",\"decodeMs\":" + std::to_string(decode_ms) + ",\"totalMs\":" + std::to_string(t1 - t0) +
               ",\"stopped\":" + (stopped ? "true" : "false") + "}";
    return g_result.c_str();
}

EMSCRIPTEN_KEEPALIVE const char * sp_load(const char * target_path, const char * draft_path, int n_ctx, int n_draft_max) {
    try {
        return sp_load_impl(target_path, draft_path, n_ctx, n_draft_max);
    } catch (const std::exception & e) {
        return fail(std::string("exception: ") + e.what());
    } catch (...) {
        return fail("unknown exception");
    }
}

EMSCRIPTEN_KEEPALIVE const char * sp_generate(const char * user_text, int n_predict, int use_mtp, int enable_thinking) {
    try {
        return sp_generate_impl(user_text, n_predict, use_mtp, enable_thinking);
    } catch (const std::exception & e) {
        return fail(std::string("exception: ") + e.what());
    } catch (...) {
        return fail("unknown exception");
    }
}

EMSCRIPTEN_KEEPALIVE void sp_free() {
    g_templates.reset();
    g_spec_init.reset();
    g_init.reset();
    g_model = nullptr;
    g_ctx = nullptr;
    g_ctx_dft = nullptr;
    llama_backend_free();
}

}  // extern "C"
