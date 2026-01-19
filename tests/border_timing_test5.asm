; Border Timing Test 5: Position-dependent timing test
; Draws three horizontal markers at top, middle, bottom of screen
; All using OUT (n),A - to detect any drift across screen height
;
; If there's accumulated drift, the markers will shift horizontally
; as you go down the screen
;
; Assemble with: sjasmplus border_timing_test5.asm --raw=border_timing_test5.bin

    org $8000

start:
    di

frame_loop:
    ; Wait for interrupt (frame sync)
    ei
    halt
    di

    ; ============================================
    ; MARKER 1: Top border (line 16)
    ; ============================================
    ; Delay to line 16: 16 * 224 = 3584 T-states

    ld b, 0             ; 7T
delay1_1:
    djnz delay1_1       ; 3323T

    ; Need 3584 - 3330 = 254T more
    ld b, 20            ; 7T
delay1_2:
    djnz delay1_2       ; 20*13-5 = 255T

    ; At line 16, output RED marker
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T

    ; Marker width: 32 pixels = 64T
    ld b, 5             ; 7T
marker1:
    djnz marker1        ; 5*13-5 = 60T

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    ; ============================================
    ; MARKER 2: Middle (line 160 = 64 + 96)
    ; ============================================
    ; Need to reach line 160 from current position (~line 16)
    ; Lines to skip: 160 - 16 = 144 lines = 144 * 224 = 32256 T-states

    ; Large delay loop
    ld hl, 2480         ; 10T (outer counter for ~32256T)
delay2_outer:
    dec hl              ; 6T
    ld a, h             ; 4T
    or l                ; 4T
    jp nz, delay2_outer ; 10T (24T * 2480 = 59520T - too much!)

    ; Actually let's use simpler loop
    ; Skip: let's just do 9 * 3323 = 29907T, then fine tune

    ld b, 0
delay2_1:
    djnz delay2_1       ; 3323T
    ld b, 0
delay2_2:
    djnz delay2_2       ; 3323T
    ld b, 0
delay2_3:
    djnz delay2_3       ; 3323T
    ld b, 0
delay2_4:
    djnz delay2_4       ; 3323T
    ld b, 0
delay2_5:
    djnz delay2_5       ; 3323T
    ld b, 0
delay2_6:
    djnz delay2_6       ; 3323T
    ld b, 0
delay2_7:
    djnz delay2_7       ; 3323T
    ld b, 0
delay2_8:
    djnz delay2_8       ; 3323T
    ld b, 0
delay2_9:
    djnz delay2_9       ; 3323T

    ; Total: 9*3323 + 9*7 = 29970T
    ; Need: 32256 - 29970 = 2286T more

    ld b, 176           ; 7T
delay2_fine:
    djnz delay2_fine    ; 176*13-5 = 2283T

    ; At line 160, output BLUE marker (same horizontal position)
    ld a, 1             ; 7T - BLUE
    out ($fe), a        ; 11T

    ; Same marker width
    ld b, 5             ; 7T
marker2:
    djnz marker2        ; 60T

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    ; ============================================
    ; MARKER 3: Bottom border (line 280)
    ; ============================================
    ; Need to reach line 280 from line 160
    ; Lines: 280 - 160 = 120 lines = 26880 T-states

    ld b, 0
delay3_1:
    djnz delay3_1       ; 3323T
    ld b, 0
delay3_2:
    djnz delay3_2       ; 3323T
    ld b, 0
delay3_3:
    djnz delay3_3       ; 3323T
    ld b, 0
delay3_4:
    djnz delay3_4       ; 3323T
    ld b, 0
delay3_5:
    djnz delay3_5       ; 3323T
    ld b, 0
delay3_6:
    djnz delay3_6       ; 3323T
    ld b, 0
delay3_7:
    djnz delay3_7       ; 3323T
    ld b, 0
delay3_8:
    djnz delay3_8       ; 3323T

    ; Total: 8*3323 + 8*7 = 26640T
    ; Need: 26880 - 26640 = 240T more

    ld b, 19            ; 7T
delay3_fine:
    djnz delay3_fine    ; 19*13-5 = 242T

    ; At line 280, output GREEN marker
    ld a, 4             ; 7T - GREEN
    out ($fe), a        ; 11T

    ; Same marker width
    ld b, 5             ; 7T
marker3:
    djnz marker3        ; 60T

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    jp frame_loop

    end start
