# Diagnostic only. Set explicit NT substitute names, bypassing CreateSymbolicLink's DOS-path conversion.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class NativeNullProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(SafeFileHandle handle, uint code, byte[] input, int inputSize, IntPtr output, uint outputSize, out uint returned, IntPtr overlapped);
  static void U16(byte[] b, int offset, ushort value) { Buffer.BlockCopy(BitConverter.GetBytes(value), 0, b, offset, 2); }
  static void U32(byte[] b, int offset, uint value) { Buffer.BlockCopy(BitConverter.GetBytes(value), 0, b, offset, 4); }
  public static void Link(string path, string target) {
    File.WriteAllText(path, "");
    var substitute = Encoding.Unicode.GetBytes(target);
    var print = Encoding.Unicode.GetBytes(target);
    var buffer = new byte[20 + substitute.Length + 2 + print.Length + 2];
    U32(buffer, 0, 0xA000000C); // IO_REPARSE_TAG_SYMLINK
    U16(buffer, 4, (ushort)(buffer.Length - 8));
    U16(buffer, 8, 0);
    U16(buffer, 10, (ushort)substitute.Length);
    U16(buffer, 12, (ushort)(substitute.Length + 2));
    U16(buffer, 14, (ushort)print.Length);
    U32(buffer, 16, 0); // absolute NT substitute name
    Buffer.BlockCopy(substitute, 0, buffer, 20, substitute.Length);
    Buffer.BlockCopy(print, 0, buffer, 20 + substitute.Length + 2, print.Length);
    using (var handle = CreateFile(path, 0x40000000, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      uint returned;
      if (!DeviceIoControl(handle, 0x000900A4, buffer, buffer.Length, IntPtr.Zero, 0, out returned, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }
  public static void Junction(string path, string target) {
    Directory.CreateDirectory(path);
    var bytes = Encoding.Unicode.GetBytes(target);
    var buffer = new byte[16 + bytes.Length + 2];
    U32(buffer, 0, 0xA0000003); // IO_REPARSE_TAG_MOUNT_POINT
    U16(buffer, 4, (ushort)(buffer.Length - 8));
    U16(buffer, 8, 0);
    U16(buffer, 10, (ushort)bytes.Length);
    U16(buffer, 12, (ushort)(bytes.Length + 2));
    U16(buffer, 14, 0);
    Buffer.BlockCopy(bytes, 0, buffer, 16, bytes.Length);
    using (var handle = CreateFile(path, 0x40000000, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      uint returned;
      if (!DeviceIoControl(handle, 0x000900A4, buffer, buffer.Length, IntPtr.Zero, 0, out returned, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }
}
'@
$dir = Join-Path $env:TEMP ("pi-native-null-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
$targets = @('\Device\Null', '\??\NUL', '\GLOBAL??\NUL', '\??\GLOBALROOT\Device\Null')
try {
  for ($i = 0; $i -lt $targets.Count; $i++) {
    $path = Join-Path $dir "$i.jsonl"
    try { [NativeNullProbe]::Link($path, $targets[$i]); Write-Host "Created $path -> $($targets[$i])" }
    catch { Write-Host "Create failed: $($_.Exception.Message)" }
  }
  for ($i = 0; $i -lt $targets.Count; $i++) {
    try { [NativeNullProbe]::Junction((Join-Path $dir "junction-$i"), $targets[$i]); Write-Host "Junction -> $($targets[$i])" }
    catch { Write-Host "Junction failed: $($_.Exception.Message)" }
  }
  $env:PI_RAW_NULL_DIR = $dir
  node test/windows-native-null-probe.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item -Recurse -Force $dir
}
