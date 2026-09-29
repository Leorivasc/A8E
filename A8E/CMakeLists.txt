cmake_minimum_required(VERSION 3.16)

project(A8E LANGUAGES C)

include(CTest)

# --- Configuration ---
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)

if(POLICY CMP0074)
  cmake_policy(SET CMP0074 NEW)
endif()

# --- Build Version (shared with jsA8E release tracking) ---
set(A8E_BUILD_VERSION "dev")
set(A8E_VERSION_FILE "${CMAKE_CURRENT_SOURCE_DIR}/../jsA8E/version.json")

if(EXISTS "${A8E_VERSION_FILE}")
  file(READ "${A8E_VERSION_FILE}" A8E_VERSION_JSON)
  string(
    REGEX MATCH
    "\"version\"[ \t\r\n]*:[ \t\r\n]*\"([^\"]+)\""
    A8E_VERSION_MATCH
    "${A8E_VERSION_JSON}"
  )
  if(CMAKE_MATCH_1)
    set(A8E_BUILD_VERSION "${CMAKE_MATCH_1}")
  endif()
endif()

message(STATUS "A8E build version: ${A8E_BUILD_VERSION}")

# --- Dependencies ---
# Add common Homebrew prefixes before dependency discovery.
if(APPLE)
  if(EXISTS "/opt/homebrew")
    list(PREPEND CMAKE_PREFIX_PATH "/opt/homebrew")
  endif()
  if(EXISTS "/usr/local")
    list(PREPEND CMAKE_PREFIX_PATH "/usr/local")
  endif()
endif()

# 1. SDL2
find_package(SDL2 REQUIRED)

set(A8E_CORE_SOURCES
  6502.c
  Antic.c
  AtariIo.c
  Gtia.c
  Pia.c
  Pokey.c
)

function(a8e_configure_target target_name)
  target_compile_definitions(${target_name} PRIVATE A8E_BUILD_VERSION=\"${A8E_BUILD_VERSION}\")

  # --- Include Directories ---
  target_include_directories(${target_name} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")

  # SDL2: modern config provides SDL2::SDL2 imported target; old-style provides
  # SDL2_INCLUDE_DIRS / SDL2_LIBRARIES variables.
  if(TARGET SDL2::SDL2)
    # Imported target typically sets INTERFACE_INCLUDE_DIRECTORIES to
    # "${prefix}/include/SDL2" which is too specific for our
    # #include <SDL2/SDL.h>. Add both that path and its parent so the
    # headers can be included in the same way as the old SDL2_INCLUDE_DIRS
    # behaviour.
    get_property(_sdl_includes TARGET SDL2::SDL2 PROPERTY INTERFACE_INCLUDE_DIRECTORIES)
    foreach(_d ${_sdl_includes})
      target_include_directories(${target_name} PRIVATE "${_d}")
      get_filename_component(_parent "${_d}" DIRECTORY)
      target_include_directories(${target_name} PRIVATE "${_parent}")
    endforeach()
  else()
    target_include_directories(${target_name} PRIVATE ${SDL2_INCLUDE_DIRS})
    # Also expose the parent dir so <SDL2/SDL.h> resolves correctly.
    foreach(_d ${SDL2_INCLUDE_DIRS})
      get_filename_component(_parent "${_d}" DIRECTORY)
      target_include_directories(${target_name} PRIVATE "${_parent}")
    endforeach()
  endif()

  # --- Linking ---
  # --- Platform Specifics ---

  if(MINGW)
    # MinGW link order matters: mingw32, SDL2main, then SDL2.
    if(TARGET SDL2::SDL2main)
      target_link_libraries(${target_name} PRIVATE mingw32 SDL2::SDL2main SDL2::SDL2)
    elseif(TARGET SDL2::SDL2)
      target_link_libraries(${target_name} PRIVATE mingw32 SDL2::SDL2)
    else()
      target_link_libraries(${target_name} PRIVATE mingw32 ${SDL2_LIBRARIES})
    endif()
  elseif(TARGET SDL2::SDL2)
    if(TARGET SDL2::SDL2main)
      target_link_libraries(${target_name} PRIVATE SDL2::SDL2main SDL2::SDL2)
    else()
      target_link_libraries(${target_name} PRIVATE SDL2::SDL2)
    endif()
  else()
    target_link_libraries(${target_name} PRIVATE ${SDL2_LIBRARIES})
  endif()

  if(MSVC)
    # SDL2 static builds on MSVC need explicit Win32 system libs (SDL2's CMake
    # config usually adds these automatically, but keep them as a fallback).
    target_link_libraries(${target_name} PRIVATE winmm version imm32)
  endif()

  if(APPLE)
    if(NOT TARGET SDL2::SDL2)
      find_library(COCOA_FRAMEWORK Cocoa REQUIRED)
      target_link_libraries(${target_name} PRIVATE "${COCOA_FRAMEWORK}")
    endif()
  endif()

  if(UNIX AND NOT APPLE)
    # Linux/Unix requires the math library
    target_link_libraries(${target_name} PRIVATE m)
  endif()
endfunction()

add_executable(A8E
  A8E.c
  ${A8E_CORE_SOURCES}
)

a8e_configure_target(A8E)

if(BUILD_TESTING)
  add_executable(antic_timing_probe
    tests/antic_timing_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(antic_timing_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(antic_timing_probe)

  add_test(NAME antic_timing_probe COMMAND antic_timing_probe)
  set_tests_properties(antic_timing_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(antic_dma_probe
    tests/antic_dma_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(antic_dma_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(antic_dma_probe)

  add_test(NAME antic_dma_probe COMMAND antic_dma_probe)
  set_tests_properties(antic_dma_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(antic_graphics_modes_probe
    tests/antic_graphics_modes_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(antic_graphics_modes_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(antic_graphics_modes_probe)

  add_test(NAME antic_graphics_modes_probe COMMAND antic_graphics_modes_probe)
  set_tests_properties(antic_graphics_modes_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(pokey_pot_scan_probe
    tests/pokey_pot_scan_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(pokey_pot_scan_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(pokey_pot_scan_probe)

  add_test(NAME pokey_pot_scan_probe COMMAND pokey_pot_scan_probe)
  set_tests_properties(pokey_pot_scan_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(pokey_timer_period_probe
    tests/pokey_timer_period_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(pokey_timer_period_probe PRIVATE
    A8E_ENABLE_TEST_PROBES=1
    A8E_TRACE_FIXTURE_PATH="${CMAKE_CURRENT_SOURCE_DIR}/../implementation/traces/pokey_timer_contract.jsonl"
  )
  a8e_configure_target(pokey_timer_period_probe)

  add_test(NAME pokey_timer_period_probe COMMAND pokey_timer_period_probe)
  set_tests_properties(pokey_timer_period_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  # This probe includes Pokey.c to observe private audio flip-flops.
  set(A8E_LINKED_AUDIO_PROBE_SOURCES ${A8E_CORE_SOURCES})
  list(REMOVE_ITEM A8E_LINKED_AUDIO_PROBE_SOURCES Pokey.c)
  add_executable(pokey_linked_audio_probe
    tests/pokey_linked_audio_probe.c
    ${A8E_LINKED_AUDIO_PROBE_SOURCES}
  )
  a8e_configure_target(pokey_linked_audio_probe)
  add_test(NAME pokey_linked_audio_probe COMMAND pokey_linked_audio_probe)

  add_executable(pokey_sio_contract_probe
    tests/pokey_sio_contract_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(pokey_sio_contract_probe PRIVATE
    A8E_ENABLE_TEST_PROBES=1
    A8E_TRACE_FIXTURE_PATH="${CMAKE_CURRENT_SOURCE_DIR}/../implementation/traces/pokey_sio_contract.jsonl"
  )
  a8e_configure_target(pokey_sio_contract_probe)

  add_test(NAME pokey_sio_contract_probe COMMAND pokey_sio_contract_probe)
  set_tests_properties(pokey_sio_contract_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(keyboard_irq_gate_probe
    tests/keyboard_irq_gate_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(keyboard_irq_gate_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(keyboard_irq_gate_probe)

  add_test(NAME keyboard_irq_gate_probe COMMAND keyboard_irq_gate_probe)
  set_tests_properties(keyboard_irq_gate_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(memory_expansion_probe
    tests/memory_expansion_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(memory_expansion_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(memory_expansion_probe)

  add_test(NAME memory_expansion_probe COMMAND memory_expansion_probe)
  set_tests_properties(memory_expansion_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(gtia_consol_probe
    tests/gtia_consol_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(gtia_consol_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(gtia_consol_probe)

  add_test(NAME gtia_consol_probe COMMAND gtia_consol_probe)
  set_tests_properties(gtia_consol_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(pia_control_probe
    tests/pia_control_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(pia_control_probe PRIVATE A8E_ENABLE_TEST_PROBES=1)
  a8e_configure_target(pia_control_probe)

  add_test(NAME pia_control_probe COMMAND pia_control_probe)
  set_tests_properties(pia_control_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")

  add_executable(differential_pia_trace_probe
    tests/differential_pia_trace_probe.c
    ${A8E_CORE_SOURCES}
  )

  target_compile_definitions(differential_pia_trace_probe PRIVATE
    A8E_ENABLE_TEST_PROBES=1
    A8E_TRACE_FIXTURE_PATH="${CMAKE_CURRENT_SOURCE_DIR}/../implementation/traces/pia_portb_contract.jsonl"
  )
  a8e_configure_target(differential_pia_trace_probe)

  add_test(NAME differential_pia_trace_probe COMMAND differential_pia_trace_probe)
  set_tests_properties(differential_pia_trace_probe PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.." ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=dummy")
endif()
