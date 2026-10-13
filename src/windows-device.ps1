param(
  [Parameter(Mandatory=$true)][ValidateSet('map', 'redirect', 'sweep')][string]$Action,
  [string]$Name,
  [string]$File,
  [int]$OwnerPid = 0,
  [string]$Keep = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class IncognitoDevice {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool DefineDosDevice(uint flags, string name, string target);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint QueryDosDevice(string name, [Out] char[] target, int length);
  public static string[] Query(string name) {
    var buffer = new char[65536];
    uint count = QueryDosDevice(name, buffer, buffer.Length);
    if (count == 0) {
      int error = Marshal.GetLastWin32Error();
      if (error == 2) return new string[0];
      throw new Win32Exception(error);
    }
    return new string(buffer, 0, (int)count).Split(new char[] {'\0'}, StringSplitOptions.RemoveEmptyEntries);
  }
  public static void Map(string name, string target) {
    if (!DefineDosDevice(1 | 8, name, target)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Remove(string name, string target) {
    if (!DefineDosDevice(1 | 2 | 4 | 8, name, target)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
$pattern = '^pi-incognito-(\d+)-[0-9a-f]{8}$'
if ($Action -ne 'sweep' -and $Name -notmatch $pattern) { throw 'Invalid incognito device name.' }
if ($Action -eq 'map') {
  if ([IncognitoDevice]::Query($Name).Length -ne 0) { throw 'Incognito device already exists.' }
  [IncognitoDevice]::Map($Name, "\??\$File")
} elseif ($Action -eq 'redirect') {
  [IncognitoDevice]::Map($Name, '\Device\Null')
  # DefineDosDevice pushes definitions. Remove the bootstrap definition underneath
  # the Null mapping, so deleting Null can never expose the public copy again.
  [IncognitoDevice]::Remove($Name, "\??\$File")
  if ([IncognitoDevice]::Query($Name)[0] -ne '\Device\Null') { throw 'Null-device redirection failed.' }
} else {
  foreach ($device in [IncognitoDevice]::Query($null)) {
    if ($device -notmatch $pattern -or $device -eq $Keep) { continue }
    $pidFromName = [int]$Matches[1]
    if ($pidFromName -eq $OwnerPid -or -not (Get-Process -Id $pidFromName -ErrorAction SilentlyContinue)) {
      foreach ($target in [IncognitoDevice]::Query($device)) {
        [IncognitoDevice]::Remove($device, $target)
      }
    }
  }
}
