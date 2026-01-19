; Border Timing Test 1: OUT (n),A vs OUT (C),r comparison
; This test outputs identical patterns using both OUT types
; If emulator handles both correctly, stripes should align perfectly
;
; Assemble with: sjasmplus border_timing_test1.asm --raw=border_timing_test1.bin

    org $8000

start:
    di

    ; Wait for frame start (HALT waits for interrupt)
    ; We need interrupts enabled briefly for HALT
    ei
    halt
    di

    ; Now at start of frame (T=0 approximately)
    ; Wait until top border area - line 16 (about 16*224 = 3584 T-states)

    ; Delay ~3500 T-states to get to visible top border
    ld b, 175           ; 7T
delay1:
    djnz delay1         ; 175 * 13T - 5T = 2270T (+ 7T = 2277T)

    ; Additional delay
    ld b, 95
delay2:
    djnz delay2         ; 95 * 13T - 5T = 1230T

    ; Total: ~3507T - now in top border

    ; === Test pattern using OUT (n),A ===
    ; Output RED stripe
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T - OUT (n),A

    ; Short delay (visible stripe width)
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    ; Output BLACK
    xor a               ; 4T - BLACK
    out ($fe), a        ; 11T

    ; Delay to next line (224T total per line)
    ; We've used: 7+11+16+4+11 = 49T, need ~175T more
    ld b, 13
delay3:
    djnz delay3         ; 13*13-5 = 164T
    nop                 ; 4T
    nop                 ; 4T

    ; === Same pattern using OUT (C),r ===
    ; Output BLUE stripe
    ld a, 1             ; 7T - BLUE
    ld bc, $00fe        ; 10T
    out (c), a          ; 12T - OUT (C),r

    ; Short delay (same width)
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    ; Output BLACK
    xor a               ; 4T
    out (c), a          ; 12T

    ; Loop forever
    jp start

    end start
