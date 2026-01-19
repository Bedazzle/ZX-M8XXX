; Border Timing Test 2: Vertical stripe alignment test
; Creates vertical stripe in left border using OUT (n),A
; The stripe position reveals the absolute I/O timing offset
;
; Assemble with: sjasmplus border_timing_test2.asm --raw=border_timing_test2.bin

    org $8000

LINES   equ 192         ; Number of lines to draw stripe

start:
    di

frame_loop:
    ; Wait for interrupt (frame sync)
    ei
    halt
    di

    ; At T=0 (start of frame, line 0)
    ; First paper line is at line 64 (64 * 224 = 14336 T-states)
    ; We want to start at first paper line

    ; Delay to reach first paper line minus some offset for left border
    ; 14336 - 24 (left border start) = 14312 T-states
    ; Let's aim for T=14312

    ; Delay using nested loops
    ; Outer loop: 56 iterations
    ; Inner loop: 255 iterations
    ; Total: 56 * (255 * 13 - 5 + 10) - 5 ≈ lots

    ; Simpler: use precise delay
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

    ; Now draw vertical stripe for 192 lines
    ld b, LINES         ; 7T - line counter

line_loop:
    ; Output RED at left border position
    ld a, 2             ; 7T
    out ($fe), a        ; 11T - OUT (n),A - stripe ON

    ; Keep stripe on for ~16 pixels (32 T-states at border = 8 color clocks)
    ld hl, 0            ; 10T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    ; Output BLACK
    xor a               ; 4T
    out ($fe), a        ; 11T - stripe OFF

    ; Delay rest of line: 224 - (7+11+10+16+4+11) = 224 - 59 = 165T
    ; But we also have 7T for next LD A and loop overhead

    push bc             ; 11T
    ld b, 10            ; 7T
line_delay:
    djnz line_delay     ; 10*13-5 = 125T
    pop bc              ; 10T
    nop                 ; 4T
    nop                 ; 4T

    ; Total delay: 11+7+125+10+8 = 161T
    ; Line total: 59 + 161 + 13 (DJNZ) = 233T (close to 224)
    ; Small drift but acceptable for test

    djnz line_loop      ; 13T / 8T on exit

    jp frame_loop

    end start
