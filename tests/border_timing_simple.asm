; Simple Border Timing Test
; Outputs immediately after HALT to test absolute frame timing
; No delay loops - just HALT -> OUT
;
; This shows where T≈0 maps to on screen
;
; Assemble with: sjasmplus border_timing_simple.asm --raw=border_timing_simple.bin

    org $8000

start:
    di

frame_loop:
    ei
    halt                ; Wait for INT (wakes at T≈0)
    di

    ; === Immediate OUT (n),A - RED ===
    ; Should appear at T≈13 (after INT response) + a few T-states
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T

    ; Very short - 8T (4 pixels)
    nop                 ; 4T
    nop                 ; 4T

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    ; 10 more T-states
    nop
    nop

    ; === Immediate OUT (C),r - BLUE ===
    ld a, 1             ; 7T - BLUE
    ld bc, $00fe        ; 10T
    out (c), a          ; 12T

    ; Very short
    nop
    nop

    xor a               ; 4T
    out (c), a          ; 12T - BLACK

    jp frame_loop

    end start
