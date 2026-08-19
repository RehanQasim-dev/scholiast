cmake_minimum_required(VERSION 3.22.1)
project(scholiast_whisper)

# ------------------------------------------------------------------
# Local STT engine: vendored whisper.cpp/GGML from the FUTO Keyboard
# (FUTO Source First License 1.1 — personal/sideloaded use only).
# Compiles ONLY the whisper inference stack + the WhisperGGML JNI glue —
# NOT the LatinIME dictionary/downsample stack from the FUTO CMake.
# ------------------------------------------------------------------

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_ANDROID_STL_TYPE c++_static)

# GGML is unusably slow without optimization
set(CMAKE_C_FLAGS_RELEASE   "-O3 -DNDEBUG")
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")
set(CMAKE_C_FLAGS_DEBUG   "-O1 -g")
set(CMAKE_CXX_FLAGS_DEBUG "-O1 -g")

add_compile_options(
        -Wall -Wextra
        -Wno-unused-parameter -Wno-unused-function
        -Wno-deprecated-copy -Wno-vla-cxx-extension
        -fexceptions
        -DHAVE_PTHREAD
)

# Enable NEON unconditionally (same as LOCAL_ARM_NEON := true)
if(ANDROID_ABI MATCHES "armeabi-v7a")
    add_compile_options(-mfpu=neon)
endif()

add_library(scholiast_whisper SHARED
        org_futo_voiceinput_WhisperGGML.cpp
        jni_common.cpp
        jni_utils.cpp
        ggml/whisper.cpp
        ggml/ggml.c
        ggml/ggml-alloc.c
        ggml/ggml-backend.c
        ggml/ggml-quants.c
)

target_include_directories(scholiast_whisper PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/ggml
)

target_link_libraries(scholiast_whisper
        log
        dl
)