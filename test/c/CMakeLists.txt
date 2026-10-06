# Builds the C tests against an installed native-dawn, exactly as an outside
# project would: find_package(Dawn) from the install prefix.
#   cmake -S test/c -B test/c/build -DCMAKE_PREFIX_PATH=<prefix>
cmake_minimum_required(VERSION 3.22)
project(native_dawn_c_tests LANGUAGES C)
set(CMAKE_C_STANDARD 11)

find_package(Dawn REQUIRED)
get_filename_component(NATIVE_DAWN_PREFIX "${Dawn_DIR}/../../.." ABSOLUTE)

add_executable(compute compute.c)
target_link_libraries(compute PRIVATE dawn::webgpu_dawn)

option(NATIVE_DAWN_TEST_SDL2 "Build the SDL2 window test" OFF)
if(NATIVE_DAWN_TEST_SDL2)
  find_package(SDL2 REQUIRED)
  add_executable(sdl2_window sdl2_window.c)
  target_include_directories(sdl2_window PRIVATE "${NATIVE_DAWN_PREFIX}/include")
  target_link_libraries(sdl2_window PRIVATE dawn::webgpu_dawn SDL2::SDL2)
endif()
