; Border Timing Test 4: Direct comparison on same scanline
; Outputs RED (OUT (n),A) then BLUE (OUT (C),r) on same line
; If both OUT types are timed identically, the gap between stripes
; should be exactly predictable based on instruction timing
;
; Assemble with: sjasmplus border_timing_test4.asm --raw=border_timing_test4.bin

    org $8000

LINES   equ 50          ; Number of lines to draw pattern

start:
    di

frame_loop:
    ; Wait for interrupt (frame sync)
    ei
    halt
    di

    ; Delay to reach line 32 (top border, well visible)
    ; Line 32 = 32 * 224 = 7168 T-states

    ld b, 0             ; 7T
delay1:
    djnz delay1         ; 3323T

    ld b, 0
delay2:
    djnz delay2         ; 3323T

    ; Total: 6660T, need 7168-6660 = 508T more
    ld b, 39            ; 7T
delay3:
    djnz delay3         ; 39*13-5 = 502T

    ; At approximately line 32, left edge
    ; Setup for OUT (C),r
    ld bc, $00fe        ; 10T

    ld d, LINES         ; 7T - line counter

line_loop:
    ; Pattern: BLACK -> RED (OUT n,A) -> BLACK -> BLUE (OUT C,r) -> BLACK

    ; === First stripe: RED using OUT (n),A ===
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T - OUT (n),A - RED ON

    ; Stripe width: 8 pixels = 16T (at border quantization)
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    ; BLACK gap
    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    ; Gap between stripes: 16 pixels = 32T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    ; === Second stripe: BLUE using OUT (C),r ===
    ld a, 1             ; 7T - BLUE
    out (c), a          ; 12T - OUT (C),r - BLUE ON

    ; Stripe width: 8 pixels = 16T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    ; BLACK
    xor a               ; 4T
    out (c), a          ; 12T - BLACK

    ; Delay rest of line
    ; Used: 7+11+16+4+11+32+7+12+16+4+12 = 132T
    ; Need: 224-132 = 92T (minus loop overhead)

    push de             ; 11T
    ld e, 5             ; 7T
line_delay:
    dec e               ; 4T
    jp nz, line_delay   ; 10T (14T * 5 - 4 = 66T)
    pop de              ; 10T
    ; Total: 11+7+66+10 = 94T

    dec d               ; 4T
    jp nz, line_loop    ; 10T

    jp frame_loop

    end start
