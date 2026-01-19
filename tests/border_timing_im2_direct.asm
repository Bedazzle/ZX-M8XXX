; Border Timing Test - IM2 Direct (like Aquaplane)
; Does border output INSIDE the interrupt handler
; This mimics Aquaplane's timing model
;
; Assemble with: sjasmplus border_timing_im2_direct.asm --raw=border_timing_im2_direct.bin

    org $8000

start:
    di

    ; Setup IM2 with I=$FE
    ; Vector table at $FE00-$FF00 (high RAM, safe area)
    ; Vector read: (I << 8) | $FF = $FE00 + $FF = $FEFF
    ; Word at $FEFF will be $8080 (handler address)
    ld a, $FE
    ld i, a
    im 2

    ; Fill vector table $FE00-$FF00 (257 bytes) with $80
    ; This makes any vector read return $8080 (handler address)
    ld hl, $FE00
    ld de, $FE01
    ld bc, 256          ; 257 bytes total
    ld (hl), $80        ; Low byte of handler ($8080)
    ldir

    ; Jump to main loop (after handler code)
    jp main_loop

    ; Handler at $8080 (aligned for easy vector table)
    org $8080

im2_handler:
    ; INT response takes 19T
    ; This handler runs at T≈19 (like Aquaplane)

    push af             ; 11T - save AF
    push bc             ; 11T - save BC

    ; Now at T≈41 after INT
    ; Delay to visible border area (line 48)
    ; Target: 48 * 224 = 10752T
    ; Already: ~41T, need ~10711T

    ld b, 0             ; 7T (256 iter)
delay1:
    djnz delay1         ; 3323T

    ld b, 0
delay2:
    djnz delay2         ; 3323T

    ld b, 0
delay3:
    djnz delay3         ; 3323T

    ; Total: 9969T + 21T = 9990T, need ~721T more
    ld b, 56            ; 7T
delay4:
    djnz delay4         ; 56*13-5 = 723T

    ; Now at line 48, draw pattern
    ld e, 20            ; line counter

line_loop:
    ; === RED stripe using OUT (n),A ===
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T

    nop                 ; 4T x4 = 16T
    nop
    nop
    nop

    xor a               ; 4T - BLACK
    out ($fe), a        ; 11T

    ; Delay to next line
    ld b, 13            ; 7T
delay_line1:
    djnz delay_line1    ; 164T
    nop                 ; 4T

    ; === BLUE stripe using OUT (C),r ===
    ld a, 1             ; 7T - BLUE
    ld bc, $00fe        ; 10T
    out (c), a          ; 12T

    nop                 ; 4T x4 = 16T
    nop
    nop
    nop

    xor a               ; 4T
    out (c), a          ; 12T

    ; Delay to next line
    ld b, 12            ; 7T
delay_line2:
    djnz delay_line2    ; 151T
    nop                 ; 4T
    nop                 ; 4T

    dec e               ; 4T
    jp nz, line_loop    ; 10T

    ; Done - restore and return
    pop bc              ; 10T
    pop af              ; 10T
    ei                  ; 4T
    reti                ; 14T

main_loop:
    ; Enable interrupts and loop forever
    ; The interrupt handler does all the work
    ei
    halt
    jp main_loop

    end start
