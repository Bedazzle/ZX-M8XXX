$b=[System.IO.File]::ReadAllBytes("c:\Backa\_media_examples\BackToThePast.mgt")
for ($i=0; $i -lt 20; $i++) {
    $sec=[Math]::Floor($i/2)
    $ent=$i%2
    $o=$sec*512+$ent*256
    $type=$b[$o]
    if ($type -eq 0) { continue }
    $name=''
    for ($j=1; $j -le 10; $j++) {
        $ch=$b[$o+$j]
        if ($ch -ge 0x20 -and $ch -lt 0x80) { $name+=[char]$ch } else { $name+='.' }
    }
    $name = $name.TrimEnd()
    $sectors=($b[$o+11] -shl 8) -bor $b[$o+12]
    $ft=$b[$o+13]; $fs=$b[$o+14]

    # Show bytes 210-230 for format analysis
    $hex210 = @()
    for ($h=210; $h -lt 230; $h++) { $hex210 += '{0:X2}' -f $b[$o+$h] }

    # G+DOS interpretation
    $tapeType = $b[$o+211]
    $gdosLen = $b[$o+212] -bor ($b[$o+213] -shl 8)
    $gdosAddr = $b[$o+214] -bor ($b[$o+215] -shl 8)
    $gdosP2 = $b[$o+216] -bor ($b[$o+217] -shl 8)

    Write-Host ("Slot {0}: type={1,2} name=[{2}] sectors={3} firstT={4} firstS={5}" -f $i, $type, $name, $sectors, $ft, $fs)
    Write-Host ("  bytes 210-229: {0}" -f ($hex210 -join ' '))
    Write-Host ("  G+DOS interp: tapeType={0} len={1} addr={2} param2={3}" -f $tapeType, $gdosLen, $gdosAddr, $gdosP2)
    Write-Host ""
}
