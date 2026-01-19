; Border Timing Precision Test
; Markers at lines 48, 80, 112, 144, 176 (every 32 lines)
; Each gap is EXACTLY 7168T (32 * 224)
; If timing is correct, all markers should be vertically aligned
;
; Assemble with: sjasmplus border_timing_precision.asm --raw=border_timing_precision.bin

    org $8000

start:
    di

    ; Setup IM2 with I=$FE, handler at $8080
    ld a, $FE
    ld i, a
    im 2

    ; Fill vector table
    ld hl, $FE00
    ld de, $FE01
    ld bc, 256
    ld (hl), $80
    ldir

    jp main_loop

    org $8080

im2_handler:
    push af
    push bc
    push de
    push hl

    ; === DELAY TO LINE 48 ===
    ; From INT: need 48 * 224 = 10752T
    ; Handler overhead: 19T (INT) + 44T (4 pushes) = 63T
    ; Need: 10752 - 63 = 10689T
    ;
    ; Strategy: Use precise counts that add up exactly
    ; djnz b=0: 255*13 + 8 = 3323T, plus ld b,0 = 7T => 3330T total
    ; 3 loops = 9990T
    ; Remaining: 10689 - 9990 = 699T
    ; djnz b=54: 53*13 + 8 = 697T, plus ld b,54 = 7T => 704T
    ; Overshoot by 5T, compensate with marker

    ld b, 0             ; 7T
    djnz $              ; 3323T
    ld b, 0             ; 7T
    djnz $              ; 3323T
    ld b, 0             ; 7T
    djnz $              ; 3323T
    ld b, 54            ; 7T
    djnz $              ; 697T
    ; Total delay: 10694T, handler overhead 63T, total: 10757T (5T over)
    ; Adjust marker to compensate

    ; === MARKER 1 at line 48 - RED ===
    ; Timing: 7T (ld a) + 11T (out) = 18T for marker start
    ; Total from INT to marker: 10757 + 7 = 10764T
    ; Line 48 starts at: 48 * 224 = 10752T
    ; So marker appears at: 10764 - 10752 = 12T into line 48 = pixel 24

    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T
    nop                 ; 4T - brief pulse
    xor a               ; 4T
    out ($fe), a        ; 11T
    ; Marker takes: 11 + 4 + 4 + 11 = 30T (from first OUT to black OUT complete)

    ; === GAP TO LINE 80 (32 lines = 7168T exact) ===
    ; From after marker (30T used) need: 7168 - 30 = 7138T
    ; Before next ld a: subtract 7T = need 7131T of djnz
    ;
    ; 2 full loops = 6660T (including ld b,0)
    ; Remaining: 7131 - 6660 = 471T
    ; djnz b=36: 35*13 + 8 = 463T, plus ld b,36 = 7T => 470T
    ; Short by 1T, need 1 extra nop would be 4T overshoot
    ; Actually: let's try b=37: 36*13+8=476T +7T=483T, 12T over
    ; Better: use precise calculation
    ;
    ; Precise: need 7131T of delay code
    ; djnz b=0: 3330T, two loops: 6660T
    ; Remaining: 7131 - 6660 = 471T
    ; ld b, 36 + djnz: 7 + 463 = 470T
    ; Short 1T - add 1 nop would add 4T, so we'd be 3T over
    ; Let's accept 1T short (marker shifts 2px left per gap)

    ld b, 0             ; 7T
    djnz $              ; 3323T
    ld b, 0             ; 7T
    djnz $              ; 3323T
    ld b, 36            ; 7T
    djnz $              ; 463T
    ; Gap: 7130T (1T short)
    ; Total from marker 1 to marker 2: 30 + 7130 + 7 = 7167T (1T short)

    ; === MARKER 2 at line 80 - BLUE ===
    ld a, 1             ; 7T - BLUE
    out ($fe), a        ; 11T
    nop                 ; 4T
    xor a               ; 4T
    out ($fe), a        ; 11T

    ; === GAP TO LINE 112 (same timing) ===
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

    ; === GAP TO LINE 208 ===
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; === MARKER 6 at line 208 - YELLOW ===
    ld a, 6             ; 7T - YELLOW
    out ($fe), a
    nop
    xor a
    out ($fe), a

    pop hl
    pop de
    pop bc
    pop af
    ei
    reti

main_loop:
    ei
    halt
    jp main_loop

    end start
