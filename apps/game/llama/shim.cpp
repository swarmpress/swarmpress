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
std::vector<common_chat_msg> g_messages;
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

// Splits the generated text into reasoning and answer by the template's thinking tags.
// Only the answer is streamed; reasoning tokens are counted.
struct Turn {
    bool reasons = false;  // the turn may open with a reasoning block
    std::string start_tag;
    std::vector<std::string> end_tags;
    std::string text;      // everything generated, special tokens included
    bool answering = false;
    size_t answer_from = 0;
    size_t emitted = 0;
    int reasoning_tokens = 0;

    void push(const std::string & piece) {
        text += piece;
        if (!answering) {
            if (!reasons) {
                answering = true;
                answer_from = 0;
            } else {
                // A reasoning block either opens at the start (or was opened by the prompt) and closes with an end tag.
                size_t first = text.find_first_not_of(" \t\r\n");
                const bool opened = first != std::string::npos && !start_tag.empty() && text.compare(first, std::min(start_tag.size(), text.size() - first), start_tag, 0, std::min(start_tag.size(), text.size() - first)) == 0;
                for (const auto & tag : end_tags) {
                    const size_t at = text.find(tag);
                    if (at != std::string::npos) {
                        answering = true;
                        answer_from = at + tag.size();
                        break;
                    }
                }
                if (!answering) {
                    ++reasoning_tokens;
                    // Text that does not start like the start tag, once there is enough of it, is a direct answer.
                    if (first != std::string::npos && !opened && text.size() - first >= start_tag.size()) {
                        answering = true;
                        answer_from = 0;
                        reasoning_tokens = 0;
                    }
                    if (!answering) return;
                }
                while (answer_from < text.size() && (text[answer_from] == '\n' || text[answer_from] == ' ')) ++answer_from;
                emitted = answer_from;
            }
        }
        if (text.size() > emitted) {
            emit(text.substr(emitted));
            emitted = text.size();
        }
    }
};

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

// Streams the answer to the conversation through sp_emit. use_mtp=0 decodes token by token on the target alone.
// json_schema (may be empty) constrains the answer with the grammar the chat template derives from it;
// enable_thinking lets the model reason first, capped at reasoning_budget tokens (0: no cap).
static const char * sp_generate_impl(int n_predict, int use_mtp, int enable_thinking, const char * answer_prefix, const char * json_schema, int reasoning_budget) {
    if (!g_model) return fail("no model loaded");
    if (use_mtp && !g_ctx_dft) return fail("no MTP drafter loaded");

    const llama_vocab * vocab = llama_model_get_vocab(g_model);
    const llama_seq_id seq_id = 0;

    llama_memory_clear(llama_get_memory(g_ctx), true);
    if (g_ctx_dft) llama_memory_clear(llama_get_memory(g_ctx_dft), true);

    if (g_messages.empty()) return fail("no messages");
    const bool want_schema = json_schema && json_schema[0];
    common_chat_templates_inputs inputs;
    inputs.messages = g_messages;
    inputs.enable_thinking = enable_thinking != 0;
    if (want_schema) inputs.json_schema = json_schema;
    const common_chat_params chat = common_chat_templates_apply(g_templates.get(), inputs);
    const bool reasons = enable_thinking && chat.supports_thinking && !chat.thinking_end_tags.empty();

    // The answer prefix (for example "{") is part of the prompt, and the caller adds it to the text;
    // a grammar or a reasoning block comes first, so it is not used with either.
    const bool use_prefix = !want_schema && !reasons && answer_prefix && answer_prefix[0];
    const std::string prompt = chat.prompt + (use_prefix ? answer_prefix : "");

    common_params_sampling sampling = g_params.sampling;
    if (!chat.grammar.empty()) {
        sampling.grammar = common_grammar(COMMON_GRAMMAR_TYPE_OUTPUT_FORMAT, chat.grammar);
        sampling.grammar_lazy = chat.grammar_lazy;
        for (const auto & t : chat.preserved_tokens) {
            const auto ids = common_tokenize(vocab, t, false, true);
            if (ids.size() == 1) sampling.preserved_tokens.insert(ids[0]);
        }
        for (const auto & t : chat.grammar_triggers) {
            if (t.type == COMMON_GRAMMAR_TRIGGER_TYPE_WORD) {
                const auto ids = common_tokenize(vocab, t.value, false, true);
                if (ids.size() == 1 && sampling.preserved_tokens.count(ids[0])) {
                    common_grammar_trigger tt;
                    tt.type = COMMON_GRAMMAR_TRIGGER_TYPE_TOKEN;
                    tt.value = t.value;
                    tt.token = ids[0];
                    sampling.grammar_triggers.push_back(tt);
                    continue;
                }
            }
            sampling.grammar_triggers.push_back(t);
        }
        sampling.generation_prompt = chat.generation_prompt;
    }
    if (reasons && reasoning_budget > 0) {
        sampling.reasoning_budget_tokens = reasoning_budget;
        sampling.reasoning_budget_start = common_tokenize(vocab, chat.thinking_start_tag, false, true);
        for (const auto & tag : chat.thinking_end_tags) {
            if (!tag.empty()) sampling.reasoning_budget_end.push_back(common_tokenize(vocab, tag, false, true));
        }
        if (!sampling.reasoning_budget_end.empty()) sampling.reasoning_budget_forced = sampling.reasoning_budget_end.front();
        sampling.generation_prompt = chat.generation_prompt;
    }

    // n_predict counts answer tokens; reasoning comes on top (LocalLlm's maxTokens and reasoningBudget).
    const int n_limit = n_predict + (reasons ? (reasoning_budget > 0 ? reasoning_budget : 4096) : 0);

    Turn turn;
    turn.reasons = reasons;
    turn.start_tag = chat.thinking_start_tag;
    turn.end_tags = chat.thinking_end_tags;

    std::vector<llama_token> inp = common_tokenize(g_ctx, prompt, true, true);
    if (inp.size() < 2) return fail("empty prompt");
    if ((uint32_t) inp.size() + (uint32_t) n_limit + 8 > llama_n_ctx(g_ctx)) return fail("prompt and answer exceed the context");

    common_sampler_ptr smpl(common_sampler_init(g_model, sampling));
    if (!smpl) return fail(want_schema ? "the JSON schema could not be turned into a grammar" : "failed to create the sampler");

    const double t0 = emscripten_get_now();
    int n_predicted = 0, n_drafted = 0, n_accepted = 0, n_target_steps = 0;
    bool stopped = false, eog = false;
    double t_first = 0;

    if (!use_mtp) {
        common_batch batch(g_ctx);
        // The prompt goes in batches of n_batch tokens; only the last token needs logits.
        const size_t n_batch = llama_n_batch(g_ctx);
        for (size_t start = 0; start < inp.size(); start += n_batch) {
            batch.clear();
            const size_t end = std::min(inp.size(), start + n_batch);
            for (size_t i = start; i < end; ++i) batch.add(inp[i], (llama_pos) i, seq_id, i + 1 == inp.size());
            if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch.get()) != 0) return fail("prefill failed");
        }
        llama_pos n_past = (llama_pos) inp.size();
        while (n_predicted < n_limit) {
            const llama_token id = common_sampler_sample(smpl.get(), g_ctx, -1);
            common_sampler_accept(smpl.get(), id, true);
            ++n_target_steps;
            if (n_predicted == 0) t_first = emscripten_get_now();
            ++n_predicted;
            if (llama_vocab_is_eog(vocab, id)) { eog = true; break; }
            turn.push(common_token_to_piece(g_ctx, id));
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
            // All but the last prompt token, in batches of n_batch, through the target and the drafter.
            common_batch batch_prompt(g_ctx);
            const size_t n_batch = llama_n_batch(g_ctx);
            for (size_t start = 0; start + 1 < inp.size(); start += n_batch) {
                batch_prompt.clear();
                const size_t end = std::min(inp.size() - 1, start + n_batch);
                for (size_t i = start; i < end; ++i) batch_prompt.add(inp[i], (llama_pos) i, seq_id, false);
                if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch_prompt.get()) != 0) { common_speculative_free(spec); return fail("prefill failed"); }
                if (!common_speculative_process(spec, batch_prompt)) { common_speculative_free(spec); return fail("MTP prefill failed"); }
            }
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

                int n_draft_max = std::min((int) llama_n_ctx(g_ctx) - n_past - 2, n_limit - n_predicted - 1);
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
                if (llama_vocab_is_eog(vocab, id_last)) { eog = true; done = true; break; }
                turn.push(common_token_to_piece(g_ctx, id_last));
            }
            draft.clear();
            llama_memory_seq_rm(llama_get_memory(g_ctx), seq_id, n_past, -1);
            llama_memory_seq_rm(llama_get_memory(g_ctx_dft), seq_id, n_past, -1);

            if (n_predicted >= n_limit) done = true;
            if (sp_should_stop()) { stopped = true; done = true; }
        }
        common_speculative_free(spec);
    }

    const double t1 = emscripten_get_now();
    const double decode_ms = t_first > 0 ? t1 - t_first : 0;

    // The answer: upstream's parser for this template when there is reasoning or a grammar, else the streamed text.
    std::string content = turn.answering ? turn.text.substr(std::min(turn.answer_from, turn.text.size())) : std::string();
    if (reasons || want_schema) {
        try {
            common_chat_parser_params pp(chat);
            pp.reasoning_format = COMMON_REASONING_FORMAT_AUTO;
            if (!chat.parser.empty()) pp.parser.load(chat.parser);
            const common_chat_msg msg = common_chat_parse(turn.text, stopped, pp);
            if (!msg.content.empty()) content = msg.content;
        } catch (const std::exception &) {
            // keep the streamed answer
        }
    }
    g_result = "{\"ok\":true,\"promptTokens\":" + std::to_string(inp.size()) + ",\"tokens\":" + std::to_string(n_predicted) +
               ",\"targetSteps\":" + std::to_string(n_target_steps) + ",\"drafted\":" + std::to_string(n_drafted) +
               ",\"accepted\":" + std::to_string(n_accepted) + ",\"ttftMs\":" + std::to_string(t_first > 0 ? t_first - t0 : 0) +
               ",\"decodeMs\":" + std::to_string(decode_ms) + ",\"totalMs\":" + std::to_string(t1 - t0) +
               ",\"stopped\":" + (stopped ? "true" : "false") + ",\"eog\":" + (eog ? "true" : "false") +
               ",\"reasoningTokens\":" + std::to_string(turn.reasoning_tokens) + ",\"reasoned\":" + (reasons ? "true" : "false") +
               ",\"grammar\":" + (chat.grammar.empty() ? "false" : "true") + ",\"content\":\"" + json_escape(content) + "\"}";
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

// The conversation of the next sp_generate: sp_chat_reset, then sp_chat_add per message.
EMSCRIPTEN_KEEPALIVE void sp_chat_reset() { g_messages.clear(); }

EMSCRIPTEN_KEEPALIVE void sp_chat_add(const char * role, const char * content) {
    common_chat_msg msg;
    msg.role = role;
    msg.content = content;
    g_messages.push_back(msg);
}

EMSCRIPTEN_KEEPALIVE const char * sp_generate(int n_predict, int use_mtp, int enable_thinking, const char * answer_prefix, const char * json_schema, int reasoning_budget) {
    try {
        return sp_generate_impl(n_predict, use_mtp, enable_thinking, answer_prefix, json_schema, reasoning_budget);
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
