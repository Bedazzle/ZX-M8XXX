; Border Timing Test 3: Vertical stripe using OUT (C),r
; Same as Test 2 but uses OUT (C),r instead of OUT (n),A
; Compare position with Test 2 to see timing difference
;
; Assemble with: sjasmplus border_timing_test3.asm --raw=border_timing_test3.bin

    org $8000

LINES   equ 192         ; Number of lines to draw stripe

start:
    di

frame_loop:
    ; Wait for interrupt (frame sync)
    ei
    halt
    di

    ; Same delay as Test 2 to reach first paper line left border
    ld b, 0             ; 7T (256 iterations)
delay_outer1:
    djnz delay_outer1   ; 256 * 13 - 5 = 3323T

    ld b, 0
delay_outer2:
    djnz delay_outer2   ; 3323T

    ld b, 0
delay_outer3:
    djnz delay_outer3   ; 3323T

    ld b, 0
delay_outer4:
    djnz delay_outer4   ; 3323T

    ; Total so far: 4 * 3323 + 4*7 = 13320T
    ; Need: 14312 - 13320 = 992T more

    ld b, 76            ; 7T
delay_fine:
    djnz delay_fine     ; 76*13-5 = 983T

    ; Total: ~14310T - at start of first paper line, left border

    ; Setup BC for OUT (C),r
    ld bc, $00fe        ; 10T

    ; Now draw vertical stripe for 192 lines
    ld d, LINES         ; 7T - line counter (using D since BC is port)

line_loop:
    ; Output BLUE at left border position
    ld a, 1             ; 7T - BLUE (different color than test 2)
    out (c), a          ; 12T - OUT (C),r - stripe ON

    ; Keep stripe on (same duration as test 2, adjusted for 12T vs 11T)
    ld hl, 0            ; 10T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    ; Output BLACK
    xor a               ; 4T
    out (c), a          ; 12T - stripe OFF

    ; Delay rest of line: 224 - (7+12+10+12+4+12) = 224 - 57 = 167T
    ; Slightly different from test 2 due to OUT timing

    push de             ; 11T
    ld b, 10            ; 7T
line_delay:
    djnz line_delay     ; 10*13-5 = 125T
    pop de              ; 10T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    dec d               ; 4T
    jp nz, line_loop    ; 10T

    ; Restore BC for next frame
    jp frame_loop

    end start
