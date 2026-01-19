; Border Timing Test - RUNS FROM CONTENDED MEMORY
; This version runs from $6000 (contended) to properly test internal cycle contention
; Internal T-states from DJNZ will be contended because PC is in $4000-$7FFF range
;
; Assemble with: sjasmplus border_timing_contended.asm --raw=border_timing_contended.bin

    org $6000

start:
    di

    ; Setup IM2 with I=$61, handler at $6262
    ; Fill vector table at $6100-$61FF with $62
    ; Whatever byte on data bus, (I<<8)|byte = $61xx points to $62, reading $6262
    ld a, $61
    ld i, a
    im 2

    ; Fill vector table at $6100-$6200 with $62
    ld hl, $6100
    ld de, $6101
    ld bc, 256
    ld (hl), $62
    ldir

    jp main_loop

    org $6262

im2_handler:
    push af
    push bc

    ; === DELAY TO LINE 48 ===
    ; From INT: need 48 * 224 = 10752T
    ; Handler overhead: 19T (INT) + 22T (2 pushes) = 41T
    ; Need: 10752 - 41 = 10711T
    ;
    ; 3 full loops = 9990T (3 * 3330T)
    ; Remaining: 10711 - 9990 = 721T
    ; djnz b=55: 54*13 + 8 = 710T, plus ld b,55 = 7T => 717T
    ; 4T short, close enough

    ld b, 0             ; 7T
    djnz $              ; 3323T - PC=$6267 during internal cycles (CONTENDED!)
    ld b, 0             ; 7T
    djnz $              ; 3323T - (also contended)
    ld b, 0             ; 7T
    djnz $              ; 3323T - (also contended)
    ld b, 55            ; 7T
    djnz $              ; 710T - (also contended)

    ; === MARKER 1 at line 48 - RED ===
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T
    nop                 ; 4T - brief pulse
    xor a               ; 4T
    out ($fe), a        ; 11T

    ; === GAP TO LINE 80 (32 lines = 7168T exact) ===
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; === MARKER 2 at line 80 - BLUE ===
    ld a, 1             ; 7T - BLUE
    out ($fe), a
    nop
    xor a
    out ($fe), a

    ; === GAP TO LINE 112 ===
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; === MARKER 3 at line 112 - MAGENTA ===
    ld a, 3             ; 7T - MAGENTA
    out ($fe), a
    nop
    xor a
    out ($fe), a

    ; === GAP TO LINE 144 ===
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; === MARKER 4 at line 144 - GREEN ===
    ld a, 4             ; 7T - GREEN
    out ($fe), a
    nop
    xor a
    out ($fe), a

    ; === GAP TO LINE 176 ===
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; === MARKER 5 at line 176 - CYAN ===
    ld a, 5             ; 7T - CYAN
    out ($fe), a
    nop
    xor a
    out ($fe), a

    pop bc
    pop af
    ei
    reti

main_loop:
    ei
    halt
    jp main_loop

    end start
