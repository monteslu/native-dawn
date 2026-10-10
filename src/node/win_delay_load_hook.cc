// Windows: lets dawn.node load into any program that exports Node-API, not
// only one named node.exe.
//
// The addon's Node-API imports name the module node.exe (Dawn's generated
// NapiSymbols.lib), and CMakeLists.txt links them with /DELAYLOAD:node.exe.
// When the first one is resolved, this hook answers the load of node.exe with
// the module that already provides Node-API in this process: libnode.dll when
// a program embeds Node through it, otherwise the program itself (node.exe,
// Electron, or an executable with libnode linked in that exports the
// napi_* symbols). This is the mechanism node-gyp builds into every addon
// (its win_delay_load_hook.cc).

#ifdef _MSC_VER

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <delayimp.h>
#include <string.h>

static FARPROC WINAPI native_dawn_load_host(unsigned int event, DelayLoadInfo* info) {
    if (event != dliNotePreLoadLibrary || _stricmp(info->szDll, "node.exe") != 0) {
        return nullptr;
    }
    HMODULE host = GetModuleHandleA("libnode.dll");
    if (host == nullptr) {
        host = GetModuleHandleA(nullptr);
    }
    return reinterpret_cast<FARPROC>(host);
}

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = native_dawn_load_host;

#endif  // _MSC_VER
