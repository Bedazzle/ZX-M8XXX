; Border Timing Test - IM2 version
; Same as test1b but uses IM2 interrupt mode like Aquaplane
; Compare results with IM1 version to check IM2 timing
;
; Assemble with: sjasmplus border_timing_im2.asm --raw=border_timing_im2.bin

    org $8000

; IM2 vector table at $8100 (256-byte aligned)
; Fill with $81 so vector reads give $8181
IM2_TABLE equ $8100
IM2_HANDLER equ $8181

start:
    di

    ; Setup IM2
    ld a, high IM2_TABLE  ; A = $81
    ld i, a
    im 2

    ; Fill vector table with handler address low byte
    ld hl, IM2_TABLE
    ld de, IM2_TABLE + 1
    ld bc, 256
    ld (hl), low IM2_HANDLER  ; $81
    ldir

    ; Jump to main loop
    jp main_loop

    ; Pad to $8181 for interrupt handler
    org IM2_HANDLER

im2_handler:
    ; This is called on interrupt via IM2
    ; Just set a flag and return quickly
    push af
    ld a, 1
    ld (int_flag), a
    pop af
    ei
    reti

int_flag:
    defb 0

main_loop:
    ; Clear interrupt flag
    xor a
    ld (int_flag), a

    ; Enable interrupts and wait
    ei

wait_int:
    ld a, (int_flag)
    or a
    jr z, wait_int

    ; Interrupt fired! Now at T≈19 (IM2 response time)
    di

    ; Delay to line 48 (same as test1b)
    ; Target: 48 * 224 = 10752 T-states
    ; Already consumed: ~19 (INT) + ~30 (flag check loop) ≈ 50T
    ; Need: ~10700T

    ld b, 0             ; 256 iterations
delay1:
    djnz delay1         ; 3323T

    ld b, 0
delay2:
    djnz delay2         ; 3323T

    ld b, 0
delay3:
    djnz delay3         ; 3323T

    ; Total: 9969T + 21T = 9990T
    ; Need more to reach 10700: ~710T

    ld b, 55            ; 7T
delay4:
    djnz delay4         ; 55*13-5 = 710T

    ; Now at line 48, draw 20 lines of pattern
    ld e, 20            ; line counter

line_loop:
    ; === RED stripe using OUT (n),A ===
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T

    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    xor a               ; 4T - BLACK
    out ($fe), a        ; 11T

    ; Delay to next line: 224 - 49 = 175T
    ld b, 13            ; 7T
delay_line1:
    djnz delay_line1    ; 164T
    nop                 ; 4T

    ; === BLUE stripe using OUT (C),r ===
    ld a, 1             ; 7T - BLUE
    ld bc, $00fe        ; 10T
    out (c), a          ; 12T

    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    xor a               ; 4T
    out (c), a          ; 12T

    ; Delay to next line: 224 - 57 = 167T
    ld b, 12            ; 7T
delay_line2:
    djnz delay_line2    ; 151T
    nop                 ; 4T
    nop                 ; 4T

    dec e               ; 4T
    jp nz, line_loop    ; 10T

    jp main_loop

    end start
