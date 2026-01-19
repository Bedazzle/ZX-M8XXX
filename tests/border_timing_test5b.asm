; Border Timing Test 5b: Position-dependent drift test
; Three horizontal markers at line 48, 160, 250
; All use OUT (n),A at same calculated offset
; If aligned vertically = no drift, if diagonal = drift
;
; Assemble with: sjasmplus border_timing_test5b.asm --raw=border_timing_test5b.bin

    org $8000

start:
    di

frame_loop:
    ei
    halt
    di

    ; ============================================
    ; MARKER 1: Line 48 (top border, visible)
    ; Target: 48 * 224 = 10752 T-states
    ; ============================================

    ld b, 0
d1_1:
    djnz d1_1           ; 3323T
    ld b, 0
d1_2:
    djnz d1_2           ; 3323T
    ld b, 0
d1_3:
    djnz d1_3           ; 3323T
    ; 9969T + 21T overhead = 9990T
    ; Need 10752 - 9990 = 762T

    ld b, 59
d1_4:
    djnz d1_4           ; 762T

    ; Output RED marker
    ld a, 2             ; 7T - RED
    out ($fe), a        ; 11T

    ld b, 5
m1:
    djnz m1             ; 60T (marker width)

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    ; ============================================
    ; MARKER 2: Line 160 (middle of screen)
    ; From line 48 to 160 = 112 lines = 25088 T-states
    ; ============================================

    ; We used ~93T for marker, so need 25088 - 93 = 24995T
    ld b, 0
d2_1:
    djnz d2_1           ; 3323T
    ld b, 0
d2_2:
    djnz d2_2           ; 3323T
    ld b, 0
d2_3:
    djnz d2_3           ; 3323T
    ld b, 0
d2_4:
    djnz d2_4           ; 3323T
    ld b, 0
d2_5:
    djnz d2_5           ; 3323T
    ld b, 0
d2_6:
    djnz d2_6           ; 3323T
    ld b, 0
d2_7:
    djnz d2_7           ; 3323T
    ; 7 * 3323 + 7*7 = 23310T
    ; Need 24995 - 23310 = 1685T

    ld b, 130
d2_8:
    djnz d2_8           ; 130*13-5 = 1685T

    ; Output BLUE marker (same horizontal position)
    ld a, 1             ; 7T - BLUE
    out ($fe), a        ; 11T

    ld b, 5
m2:
    djnz m2             ; 60T

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    ; ============================================
    ; MARKER 3: Line 250 (bottom border)
    ; From line 160 to 250 = 90 lines = 20160 T-states
    ; ============================================

    ; Need 20160 - 93 = 20067T
    ld b, 0
d3_1:
    djnz d3_1           ; 3323T
    ld b, 0
d3_2:
    djnz d3_2           ; 3323T
    ld b, 0
d3_3:
    djnz d3_3           ; 3323T
    ld b, 0
d3_4:
    djnz d3_4           ; 3323T
    ld b, 0
d3_5:
    djnz d3_5           ; 3323T
    ld b, 0
d3_6:
    djnz d3_6           ; 3323T
    ; 6 * 3323 + 6*7 = 19980T
    ; Need 20067 - 19980 = 87T

    ld b, 7
d3_7:
    djnz d3_7           ; 7*13-5 = 86T

    ; Output GREEN marker
    ld a, 4             ; 7T - GREEN
    out ($fe), a        ; 11T

    ld b, 5
m3:
    djnz m3             ; 60T

    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    jp frame_loop

    end start
