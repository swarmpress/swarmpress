# The browser build of upstream llama.cpp (ADR-0066): ggml WebGPU through
# Dawn's emdawnwebgpu, wasm64 (the target GGUF is over 4 GB), JSPI for the GPU
# waits. Configured by scripts/llama-runtime.mjs; upstream is not patched.
cmake_minimum_required(VERSION 3.14)
project(swarmpress-llama C CXX)

set(LLAMA_CPP_DIR "" CACHE PATH "Path to the pinned llama.cpp checkout")
if(NOT EXISTS "${LLAMA_CPP_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "llama.cpp not found at '${LLAMA_CPP_DIR}'")
endif()

set(CMAKE_CXX_STANDARD 17)

# wasm64 for everything, the shim included (upstream sets it only in its own directory).
# pthreads: upstream's common logger runs on a thread of its own (the page is cross-origin isolated).
add_compile_options("-sMEMORY64=1" "-fwasm-exceptions" "-pthread")
add_link_options("-sMEMORY64=1" "-fwasm-exceptions" "-pthread")

set(GGML_WEBGPU ON CACHE BOOL "" FORCE)
set(GGML_WEBGPU_JSPI ON CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_WASM_MEM64 ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_HTML OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

add_subdirectory(${LLAMA_CPP_DIR} ${CMAKE_BINARY_DIR}/llama.cpp EXCLUDE_FROM_ALL)

add_executable(llama-shim shim.cpp)
target_link_libraries(llama-shim PRIVATE llama-common llama)
set_target_properties(llama-shim PROPERTIES OUTPUT_NAME "llama" SUFFIX ".mjs")
target_link_options(llama-shim PRIVATE
    "-sEXPORTED_FUNCTIONS=['_sp_load','_sp_generate','_sp_chat_reset','_sp_chat_add','_sp_free','_malloc','_free']"
    "-sJSPI_EXPORTS=['sp_load','sp_generate','sp_free']"
    "-sEXPORTED_RUNTIME_METHODS=['FS','WORKERFS','UTF8ToString','ccall','getExceptionMessage']"
    "-sEXPORT_EXCEPTION_HANDLING_HELPERS=1"
    "-lworkerfs.js"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sENVIRONMENT=worker"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMAXIMUM_MEMORY=16GB"
    "-sSTACK_SIZE=8388608"
    "-sWASM_BIGINT=1"
    "-sJSPI=1"
    "-sPTHREAD_POOL_SIZE=4"
    "-O3"
)
