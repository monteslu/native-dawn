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

# The Node addon is built for desktop targets only; Android gets the C SDK.
option(NATIVE_DAWN_NODE "Build the Node-API addon" ON)

set(DAWN_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.cache/dawn" CACHE PATH "Dawn checkout")

# One shared libwebgpu_dawn holds all of Dawn. The Node addon links against it
# instead of carrying a second copy, so C/C++ code and JavaScript in the same
# process share one implementation and can pass handles to each other.
set(DAWN_BUILD_MONOLITHIC_LIBRARY SHARED CACHE STRING "" FORCE)
set(DAWN_ENABLE_INSTALL ON CACHE BOOL "" FORCE)
set(DAWN_BUILD_NODE_BINDINGS ${NATIVE_DAWN_NODE} CACHE BOOL "" FORCE)
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
if(UNIX AND NOT APPLE AND NOT ANDROID)
  set(DAWN_USE_X11 ON CACHE BOOL "" FORCE)
  set(DAWN_USE_WAYLAND ON CACHE BOOL "" FORCE)
  # Vulkan covers desktop Linux GPUs. OpenGL ES stays for GPUs without a
  # Vulkan driver (WebGPU compatibility mode); desktop OpenGL adds nothing.
  set(DAWN_ENABLE_DESKTOP_GL OFF CACHE BOOL "" FORCE)
endif()
if(WIN32)
  set(DAWN_USE_BUILT_DXC ON CACHE BOOL "" FORCE)
  set(DAWN_DXC_ENABLE_ASSERTS_IN_NDEBUG OFF CACHE BOOL "" FORCE)
endif()

add_subdirectory("${DAWN_SOURCE_DIR}" dawn)

if(APPLE)
  set_target_properties(webgpu_dawn PROPERTIES INSTALL_RPATH "@loader_path" BUILD_WITH_INSTALL_RPATH ON)
elseif(UNIX)
  set_target_properties(webgpu_dawn PROPERTIES INSTALL_RPATH "$ORIGIN" BUILD_WITH_INSTALL_RPATH ON)
endif()
if(ANDROID)
  # 16 KB pages, required for apps targeting Android 15 and newer devices.
  target_link_options(webgpu_dawn PRIVATE "-Wl,-z,max-page-size=16384")
endif()

if(NATIVE_DAWN_NODE)
  # Swap the addon's static Dawn for the shared library. Its calls go straight
  # to webgpu_dawn's exports, so the dawn_proc table is dropped too (see the
  # Module.cpp hook in scripts/build.mjs).
  get_target_property(node_libs dawn_node LINK_LIBRARIES)
  list(REMOVE_ITEM node_libs dawn_native dawn_proc)
  list(APPEND node_libs webgpu_dawn)
  set_property(TARGET dawn_node PROPERTY LINK_LIBRARIES "${node_libs}")
  foreach(target dawn_node dawn_node_binding dawn_node_interop)
    target_compile_definitions(${target} PRIVATE WGPU_SHARED_LIBRARY DAWN_NATIVE_SHARED_LIBRARY)
  endforeach()

  target_sources(dawn_node PRIVATE src/node/extensions.cpp)
  target_include_directories(dawn_node PRIVATE src/node include)

  if(APPLE)
    set_target_properties(dawn_node PROPERTIES INSTALL_RPATH "@loader_path" BUILD_WITH_INSTALL_RPATH ON)
  elseif(UNIX)
    set_target_properties(dawn_node PROPERTIES INSTALL_RPATH "$ORIGIN" BUILD_WITH_INSTALL_RPATH ON)
  elseif(WIN32)
    # Node-API is imported from node.exe. Delay-load it and resolve it to the
    # module providing Node-API in the loading process (src/node/
    # win_delay_load_hook.cc), so programs that embed Node under another name
    # can load the addon too, as node-gyp addons do.
    target_sources(dawn_node PRIVATE src/node/win_delay_load_hook.cc)
    target_link_options(dawn_node PRIVATE "/DELAYLOAD:node.exe")
    target_link_libraries(dawn_node PRIVATE delayimp)
  endif()

  # The addon sits next to the shared library: lib/ on Linux and macOS, bin/ on
  # Windows, where Node resolves an addon's DLLs from the addon's own directory.
  install(TARGETS dawn_node
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()

install(DIRECTORY include/native_dawn DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(FILES "${DAWN_SOURCE_DIR}/src/dawn/dawn.json" DESTINATION share/native-dawn)
