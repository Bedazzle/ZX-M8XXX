; Border Timing Test 4b: Direct comparison on same scanline
; RED (OUT n,A) then BLUE (OUT C,r) on same line
; Starting at line 48 for visibility
;
; Assemble with: sjasmplus border_timing_test4b.asm --raw=border_timing_test4b.bin

    org $8000

LINES   equ 30

start:
    di

frame_loop:
    ei
    halt
    di

    ; Delay to line 48 (10752 T-states)
    ld b, 0
delay1:
    djnz delay1         ; 3323T
    ld b, 0
delay2:
    djnz delay2         ; 3323T
    ld b, 0
delay3:
    djnz delay3         ; 3323T

    ld b, 59
delay4:
    djnz delay4         ; 762T

    ; Setup BC for OUT (C),r
    ld bc, $00fe        ; 10T
    ld d, LINES         ; 7T

line_loop:
    ; === RED using OUT (n),A ===
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T

    nop                 ; 4T x4 = 16T
    nop
    nop
    nop

    xor a               ; 4T - BLACK
    out ($fe), a        ; 11T

    ; Gap: 32T
    nop                 ; 4T x8 = 32T
    nop
    nop
    nop
    nop
    nop
    nop
    nop

    ; === BLUE using OUT (C),r ===
    ld a, 1             ; 7T - BLUE
    out (c), a          ; 12T

    nop                 ; 4T x4 = 16T
    nop
    nop
    nop

    xor a               ; 4T - BLACK
    out (c), a          ; 12T

    ; Pad line: 224 - 132 - 14 = 78T
    ld b, 6             ; 7T
line_pad:
    djnz line_pad       ; 73T

    dec d               ; 4T
    jp nz, line_loop    ; 10T

    jp frame_loop

    end start
