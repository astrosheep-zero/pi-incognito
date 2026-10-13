# Public Windows API probe: a DOS-device alias, not an NTFS symlink.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DosDeviceProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool DefineDosDevice(uint flags, string name, string target);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint QueryDosDevice(string name, System.Text.StringBuilder target, int size);
  public static string Query(string name) {
    var text = new System.Text.StringBuilder(4096);
    if (QueryDosDevice(name, text, text.Capacity) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
    return text.ToString();
  }
  public static void Map(string name, string target) {
    if (!DefineDosDevice(1 | 8, name, target)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Remove(string name, string target) {
    if (!DefineDosDevice(1 | 2 | 4 | 8, name, target)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
$name = "pi-incognito-$PID-$([guid]::NewGuid().ToString().Substring(0, 8))"
$dir = Join-Path $env:TEMP $name
New-Item -ItemType Directory -Path $dir | Out-Null
Set-Content -NoNewline (Join-Path $dir 'public.jsonl') 'public prefix'
try {
  foreach ($device in @($name, 'Z:')) {
    foreach ($target in @("\??\$dir", "\??\$dir\public.jsonl", '\Device\Null')) {
      [DosDeviceProbe]::Map($device, $target)
      Write-Host "Query($device): $([DosDeviceProbe]::Query($device))"
      $env:PI_DEVICE_PHASE = $target
      $env:PI_DEVICE_PATH = $device
      node test/windows-dos-device-probe.mjs
      [DosDeviceProbe]::Remove($device, $target)
    }
  }
} finally {
  Get-Content (Join-Path $dir 'public.jsonl')
  Remove-Item -Recurse -Force $dir
}
