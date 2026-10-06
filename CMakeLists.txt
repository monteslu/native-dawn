cmake_minimum_required(VERSION 3.22)
project(native_dawn LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
set(CMAKE_INSTALL_LIBDIR lib CACHE PATH "" FORCE)
include(GNUInstallDirs)

# Keep checkout paths out of __FILE__ strings and debug information.
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang" AND NOT MSVC)
  add_compile_options("-ffile-prefix-map=${CMAKE_SOURCE_DIR}=.")
endif()

set(DAWN_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.cache/dawn" CACHE PATH "Dawn checkout")

# One shared libwebgpu_dawn holds all of Dawn. The Node addon links against it
# instead of carrying a second copy, so C/C++ code and JavaScript in the same
# process share one implementation and can pass handles to each other.
set(DAWN_BUILD_MONOLITHIC_LIBRARY SHARED CACHE STRING "" FORCE)
set(DAWN_ENABLE_INSTALL ON CACHE BOOL "" FORCE)
set(DAWN_BUILD_NODE_BINDINGS ON CACHE BOOL "" FORCE)
set(DAWN_ENABLE_PIC ON CACHE BOOL "" FORCE)
set(DAWN_BUILD_SAMPLES OFF CACHE BOOL "" FORCE)
set(DAWN_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(DAWN_BUILD_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(DAWN_BUILD_PROTOBUF OFF CACHE BOOL "" FORCE)
set(TINT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(TINT_BUILD_CMD_TOOLS OFF CACHE BOOL "" FORCE)
set(DAWN_USE_GLFW OFF CACHE BOOL "" FORCE)
set(DAWN_SUPPORTS_GLFW_FOR_WINDOWING OFF CACHE BOOL "" FORCE)
set(DAWN_SUPPORTS_CXX_MODULES OFF CACHE BOOL "" FORCE)
if(UNIX AND NOT APPLE)
  set(DAWN_USE_X11 ON CACHE BOOL "" FORCE)
  set(DAWN_USE_WAYLAND ON CACHE BOOL "" FORCE)
endif()
if(WIN32)
  set(DAWN_USE_BUILT_DXC ON CACHE BOOL "" FORCE)
  set(DAWN_DXC_ENABLE_ASSERTS_IN_NDEBUG OFF CACHE BOOL "" FORCE)
endif()

add_subdirectory("${DAWN_SOURCE_DIR}" dawn)

# Swap the addon's static Dawn for the shared library. The proc table stays:
# Module.cpp points it at webgpu_dawn's own procs.
get_target_property(node_libs dawn_node LINK_LIBRARIES)
list(REMOVE_ITEM node_libs dawn_native)
list(APPEND node_libs webgpu_dawn)
set_property(TARGET dawn_node PROPERTY LINK_LIBRARIES "${node_libs}")
foreach(target dawn_node dawn_node_binding dawn_node_interop)
  target_compile_definitions(${target} PRIVATE WGPU_SHARED_LIBRARY DAWN_NATIVE_SHARED_LIBRARY)
endforeach()

target_sources(dawn_node PRIVATE src/node/extensions.cpp)
target_include_directories(dawn_node PRIVATE src/node include)

if(APPLE)
  set_target_properties(dawn_node webgpu_dawn PROPERTIES INSTALL_RPATH "@loader_path" BUILD_WITH_INSTALL_RPATH ON)
elseif(UNIX)
  set_target_properties(dawn_node webgpu_dawn PROPERTIES INSTALL_RPATH "$ORIGIN" BUILD_WITH_INSTALL_RPATH ON)
endif()

# The addon sits next to the shared library: lib/ on Linux and macOS, bin/ on
# Windows, where Node resolves an addon's DLLs from the addon's own directory.
install(TARGETS dawn_node
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(DIRECTORY include/native_dawn DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(FILES "${DAWN_SOURCE_DIR}/src/dawn/dawn.json" DESTINATION share/native-dawn)
