; Border Timing Test - IM2 without HALT (like Aquaplane game loop)
; Interrupt fires during normal execution, not from HALT
;
; Assemble with: sjasmplus border_timing_im2_nohalt.asm --raw=border_timing_im2_nohalt.bin

    org $8000

start:
    di

    ; Setup IM2 with I=$FE, handler at $8080
    ld a, $FE
    ld i, a
    im 2

    ; Fill vector table $FE00-$FF00 (257 bytes) with $80
    ld hl, $FE00
    ld de, $FE01
    ld bc, 256
    ld (hl), $80
    ldir

    ; Jump to main loop
    jp main_loop

    ; Handler at $8080
    org $8080

im2_handler:
    ; INT fires during normal execution (not HALT)
    ; This tests if timing differs from HALT-based sync

    push af
    push bc

    ; Delay to line 48 (same as other tests)
    ld b, 0
delay1:
    djnz delay1         ; 3323T

    ld b, 0
delay2:
    djnz delay2         ; 3323T

    ld b, 0
delay3:
    djnz delay3         ; 3323T

    ld b, 56
delay4:
    djnz delay4         ; 723T

    ; Draw pattern
    ld e, 20

line_loop:
    ; RED stripe (OUT n,A)
    ld a, 2
    out ($fe), a

    nop
    nop
    nop
    nop

    xor a
    out ($fe), a

    ld b, 13
delay_line1:
    djnz delay_line1
    nop

    ; BLUE stripe (OUT C,r)
    ld a, 1
    ld bc, $00fe
    out (c), a

    nop
    nop
    nop
    nop

    xor a
    out (c), a

    ld b, 12
delay_line2:
    djnz delay_line2
    nop
    nop

    dec e
    jp nz, line_loop

    pop bc
    pop af
    ei
    reti

main_loop:
    ; Don't use HALT - just spin in a loop with interrupts enabled
    ; Interrupt will fire during this loop
    ei

spin:
    ; Simulate game loop - just waste time
    ld a, (ix+0)        ; 19T - slow instruction
    ld a, (ix+0)        ; 19T
    ld a, (ix+0)        ; 19T
    ld a, (ix+0)        ; 19T
    jp spin             ; 10T - loop back

    end start
