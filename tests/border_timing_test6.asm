; Border Timing Test 6: Immediate OUT after HALT
; Tests absolute timing by outputting immediately after HALT
; HALT returns at T=0 (or T=4 accounting for interrupt response)
; The position of the stripe reveals the emulator's base timing
;
; Assemble with: sjasmplus border_timing_test6.asm --raw=border_timing_test6.bin

    org $8000

start:
    di

frame_loop:
    ; Enable interrupts and halt
    ei                  ; 4T
    halt                ; Returns at frame interrupt (T=0)
    ; After HALT, we're at approximately T=0 to T=4
    ; Interrupt response adds some T-states

    ; Immediate OUT - where does this appear?
    ; T≈0 is line 0, which is in vertical blanking/top border
    ; Line 0 starts at T=0, line 1 at T=224, etc.

    ; === Pattern A: Immediate OUT (n),A after HALT ===
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T - This should appear at T≈11 (line 0, pixel ~22)

    ; Small delay
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T
    nop                 ; 4T

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK at T≈43

    ; Wait one line (224T from previous position)
    ; We've used: 7+11+16+4+11 = 49T, need 224-49=175T
    ld b, 13            ; 7T
delay1:
    djnz delay1         ; 13*13-5 = 164T
    nop                 ; 4T

    ; === Pattern B: OUT (C),r at same relative position ===
    ld a, 1             ; 7T - BLUE
    ld bc, $00fe        ; 10T
    out (c), a          ; 12T - Should appear at T≈224+29 = 253 (line 1)

    nop
    nop
    nop
    nop

    xor a               ; 4T
    out (c), a          ; 12T - BLACK

    ; Repeat pattern for several lines to make it visible
    ; Skip ~30 lines to show pattern in visible area

    ld b, 0
delay2:
    djnz delay2         ; 3323T

    ld b, 0
delay3:
    djnz delay3         ; 3323T

    ; Now at approximately line 30 (visible top border)
    ; Draw alternating pattern for 20 lines

    ld d, 20            ; line counter

visible_loop:
    ; RED stripe (OUT n,A)
    ld a, 2             ; 7T
    out ($fe), a        ; 11T
    nop
    nop
    nop
    nop
    xor a               ; 4T
    out ($fe), a        ; 11T

    ; Small gap
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop

    ; BLUE stripe (OUT C,r)
    ld bc, $00fe        ; 10T
    ld a, 1             ; 7T
    out (c), a          ; 12T
    nop
    nop
    nop
    nop
    xor a               ; 4T
    out (c), a          ; 12T

    ; Pad to exactly 224T per line
    ; Used: 7+11+16+4+11+32+10+7+12+16+4+12 = 142T
    ; Need: 224-142-14 = 68T (14T for dec d + jp)

    ld b, 5             ; 7T
line_pad:
    djnz line_pad       ; 5*13-5 = 60T

    dec d               ; 4T
    jp nz, visible_loop ; 10T

    jp frame_loop

    end start
