"""Run dev45's setup binding with Windows ownership checks for the Pi profile."""

import ctypes
import hashlib
import os
import stat
from functools import cache
from pathlib import Path

from localmodels import gateway_home, runtime_windows_acl, stack_binding
from localmodels.__main__ import main


@cache
def is_administrator() -> bool:
    """Check enabled Administrators membership, including the UAC-linked token."""
    advapi, kernel = runtime_windows_acl.api()
    pointer = ctypes.c_void_p
    advapi.CreateWellKnownSid.argtypes = [
        ctypes.c_int, pointer, pointer, ctypes.POINTER(ctypes.c_uint),
    ]
    advapi.CheckTokenMembership.argtypes = [pointer, pointer, ctypes.POINTER(ctypes.c_int)]
    # WinBuiltinAdministratorsSid fits in SECURITY_MAX_SID_SIZE bytes.
    administrators = ctypes.create_string_buffer(68)
    size = ctypes.c_uint(ctypes.sizeof(administrators))
    if not advapi.CreateWellKnownSid(26, None, administrators, ctypes.byref(size)):
        raise ctypes.WinError(ctypes.get_last_error())

    def is_member(token: ctypes.c_void_p | None) -> bool:
        member = ctypes.c_int()
        if not advapi.CheckTokenMembership(token, administrators, ctypes.byref(member)):
            raise ctypes.WinError(ctypes.get_last_error())
        return bool(member.value)

    if is_member(None):
        return True
    token = pointer()
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 0x8, ctypes.byref(token)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        # TokenElevationTypeLimited identifies the filtered half of a UAC token pair.
        elevation = ctypes.c_uint()
        returned = ctypes.c_uint()
        if not advapi.GetTokenInformation(
            token, 18, ctypes.byref(elevation), ctypes.sizeof(elevation), ctypes.byref(returned)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if elevation.value != 3:
            return False
        linked = pointer()
        if not advapi.GetTokenInformation(
            token, 19, ctypes.byref(linked), ctypes.sizeof(linked), ctypes.byref(returned)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return is_member(linked)
        finally:
            kernel.CloseHandle(linked)
    finally:
        kernel.CloseHandle(token)


def open_profile_fd(path: str, flags: int) -> int:
    import _winapi
    import msvcrt

    # Allow atomic replacement while reading the original file. Open a link itself
    # so the handle's attributes can identify it before its contents are read.
    file_share_read_delete = 0x1 | 0x4
    file_flag_open_reparse_point = 0x00200000
    handle = _winapi.CreateFile(
        path, _winapi.GENERIC_READ, file_share_read_delete, _winapi.NULL,
        _winapi.OPEN_EXISTING, file_flag_open_reparse_point, _winapi.NULL,
    )
    try:
        return msvcrt.open_osfhandle(handle, flags | os.O_NOINHERIT)
    except OSError:
        _winapi.CloseHandle(handle)
        raise


def file_owner_sid(fd: int) -> str:
    import msvcrt

    advapi, kernel = runtime_windows_acl.api()
    pointer = ctypes.c_void_p
    out = ctypes.POINTER(pointer)
    advapi.GetSecurityInfo.argtypes = [
        pointer, ctypes.c_int, ctypes.c_uint, out, out, out, out, out,
    ]
    advapi.GetSecurityInfo.restype = ctypes.c_uint
    owner, descriptor = pointer(), pointer()
    try:
        # SE_FILE_OBJECT and OWNER_SECURITY_INFORMATION request only the owner.
        error = advapi.GetSecurityInfo(
            msvcrt.get_osfhandle(fd), 1, 1, ctypes.byref(owner), None, None,
            None, ctypes.byref(descriptor),
        )
        if error:
            raise ctypes.WinError(error)
        return runtime_windows_acl.sid_text(advapi, kernel, owner)
    finally:
        if descriptor.value:
            kernel.LocalFree(descriptor)


def profile_fingerprint(executable: Path, profile: Path) -> str:
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError("Pi executable unavailable")
    if profile.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise ValueError("Pi profile is a reparse point")

    _, _, _, _, user_sid = runtime_windows_acl.identity()

    digest = hashlib.sha256(executable.read_bytes())
    for name in ("settings.json", "models.json", "auth.json"):
        path = profile / name
        try:
            source = open(path, "rb", opener=open_profile_fd)
        except FileNotFoundError:
            if name == "auth.json":
                continue
            raise
        with source:
            fd = source.fileno()
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
            ):
                raise ValueError("Pi configuration is not a regular file")
            owner = file_owner_sid(fd)
            if owner != user_sid and not (
                owner == gateway_home.ADMINISTRATORS_SID and is_administrator()
            ):
                raise ValueError("Pi configuration has a foreign owner")
            digest.update(name.encode())
            digest.update(source.read())
    return digest.hexdigest()


if __name__ == "__main__":
    stack_binding._profile_fingerprint = profile_fingerprint
    raise SystemExit(main())
