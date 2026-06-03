$bx = [System.IO.File]::ReadAllBytes("c:\Backa\_media_examples2\Dyskietka AMSOFT 1A.dsk")
Write-Host "File size: $($bx.Length)"
Write-Host "Tracks: $($bx[0x30]) Sides: $($bx[0x31])"

# Find track 4 offset from track size table
$trackOff = 0x100
for ($t=0; $t -lt 4; $t++) {
    $ts = $bx[0x34 + $t]
    $trackOff += $ts * 256
}
$ns = $bx[$trackOff+0x15]
Write-Host "Track4: Cyl=$($bx[$trackOff+0x10]) NumSectors=$ns"

# Dump first 3 sectors of track 4 (directory)
for ($sec=0; $sec -lt 3; $sec++) {
    # Find sector data offset (sectors at 0x100 after track header, each 256 bytes)
    $doff = $trackOff + 0x100 + $sec * 256
    Write-Host "--- Track 4 Sector $sec data (256 bytes) ---"
    for ($row=0; $row -lt 8; $row++) {
        $hex = ""
        $asc = ""
        for ($c=0; $c -lt 32; $c++) {
            $byte = $bx[$doff + $row*32 + $c]
            $hex += "{0:X2} " -f $byte
            if ($byte -ge 0x20 -and $byte -le 0x7E) { $asc += [char]$byte } else { $asc += "." }
        }
        Write-Host "$hex | $asc"
    }
}

# Also check track 0 sector 0
Write-Host "--- Track 0 Sector 0 data (first 32 bytes) ---"
$d0off = 0x100 + 0x100
$hex = ""
for ($c=0; $c -lt 32; $c++) { $hex += "{0:X2} " -f $bx[$d0off + $c] }
Write-Host $hex
