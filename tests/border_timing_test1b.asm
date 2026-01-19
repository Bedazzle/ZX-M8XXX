; Border Timing Test 1b: OUT (n),A vs OUT (C),r comparison
; Modified to output at line 48 (more visible in all emulators)
;
; Assemble with: sjasmplus border_timing_test1b.asm --raw=border_timing_test1b.bin

    org $8000

start:
    di

frame_loop:
    ei
    halt
    di

    ; Delay to line 48 (48 * 224 = 10752 T-states)
    ; This should be visible in all emulators

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
    ; Need: 10752 - 9990 = 762T more

    ld b, 59            ; 7T
delay4:
    djnz delay4         ; 59*13-5 = 762T

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

    jp frame_loop

    end start
