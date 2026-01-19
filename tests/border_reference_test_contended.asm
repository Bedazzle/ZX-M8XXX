; Border Timing Reference Test
; Runs from NON-CONTENDED memory ($8000) for baseline comparison
;
; Expected visual output (48K Spectrum):
;
; TOP BORDER:
;   Line 32: RED marker, 32px wide, starting at pixel 160 (center-ish)
;   Line 33: BLUE marker, 32px wide, same X as red (should align vertically)
;   Line 48: GREEN line, full visible width (~352px)
;
; PAPER AREA:
;   Line 128: YELLOW in left border (48px), then paper, then MAGENTA in right border (48px)
;
; BOTTOM BORDER:
;   Line 280: WHITE marker, 32px wide, same X as red (should align with red/blue)
;
; If timing is correct:
;   - Red, Blue, White should be vertically aligned
;   - Yellow and Magenta should be on the same horizontal line
;   - Green should span the full width
;
; Memory layout (all non-contended, $8000+):
;   $8000-$80xx: Start code (setup)
;   $8100-$81FF: Vector table (I=$81, filled with $82)
;   $8282: IM2 handler
;   After handler: main_loop
;
; Assemble with: sjasmplus border_reference_test.asm --raw=border_reference_test.bin

    org $8000

start:
    di

    ; Setup IM2 with I=$81, handler at $8282
    ; Vector table at $8100-$81FF, filled with $82
    ; Reading two bytes from $81xx gives $8282
    ld a, $81
    ld i, a
    im 2

    ; Fill vector table at $8100-$81FF with $82
    ld hl, $8100
    ld de, $8101
    ld bc, 256
    ld (hl), $82
    ldir

    jp main_loop

    org $8282

im2_handler:
    push af
    push bc
    push de
    push hl
    ; Handler overhead: 19T (IM2) + 44T (4 pushes) = 63T

    ; ============================================
    ; RED MARKER - Line 32, T=80 within line
    ; ============================================
    ; Target: T = 32 * 224 + 80 = 7248T from frame start
    ; Need delay: 7248 - 63 = 7185T
    ;
    ; Calculation:
    ; 2 x (ld b,0 + djnz) = 2 * 3330 = 6660T
    ; Remaining: 7185 - 6660 = 525T
    ; ld b,40 (7T) + djnz (39*13+8=515T) = 522T
    ; Add nop (4T) = 526T (1T over, acceptable)

    ld b, 0             ; 7T
    djnz $              ; 3323T
    ld b, 0             ; 7T
    djnz $              ; 3323T
    ld b, 40            ; 7T
    djnz $              ; 515T
    ; Total: 7182T (3T short of 7185T)

    ; RED marker - 32px wide = 16T
    ld a, 2             ; 7T
    out ($fe), a        ; 11T - RED on
    ld b, 3             ; 7T
    djnz $              ; 34T (2*13+8)
    nop                 ; 4T  (total ~16T visible)
    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK
    ; Marker block: ~78T

    ; ============================================
    ; BLUE MARKER - Line 33, T=80 within line
    ; ============================================
    ; Current position: ~7182 + 78 = 7260T
    ; Target: T = 33 * 224 + 80 = 7472T
    ; Need delay: 7472 - 7260 = 212T
    ;
    ; ld b,16 (7T) + djnz (15*13+8=203T) = 210T
    ; Add 2 nops = 218T (6T over)

    ld b, 16            ; 7T
    djnz $              ; 203T
    nop                 ; 4T
    ; Total: 214T

    ; BLUE marker - 32px wide
    ld a, 1             ; 7T
    out ($fe), a        ; 11T - BLUE on
    ld b, 3
    djnz $
    nop
    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK
    ; Marker block: ~78T

    ; ============================================
    ; GREEN LINE - Line 48, full width
    ; ============================================
    ; Current position: ~7260 + 214 + 78 = 7552T
    ; Target: T = 48 * 224 + 0 = 10752T (start of line)
    ; Need delay: 10752 - 7552 = 3200T
    ;
    ; ld b,0 (7T) + djnz (3323T) = 3330T (130T over)
    ; ld b,246 (7T) + djnz (245*13+8=3193T) = 3200T exact!

    ld b, 246           ; 7T
    djnz $              ; 3193T
    ; Total: 3200T

    ; GREEN line - full visible width (~176T = 352px)
    ld a, 4             ; 7T
    out ($fe), a        ; 11T - GREEN on
    ; Delay for full line width: 176T - some overhead
    ld b, 12            ; 7T
    djnz $              ; 151T (11*13+8)
    nop                 ; 4T
    nop                 ; 4T
    ; ~166T visible
    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK
    ; Marker block: ~210T

    ; ============================================
    ; YELLOW (left) + MAGENTA (right) - Line 128
    ; ============================================
    ; Current position: ~10752 + 210 = 10962T
    ; Target for YELLOW: T = 128 * 224 + 0 = 28672T (left border start)
    ; Need delay: 28672 - 10962 = 17710T
    ;
    ; 5 x (ld b,0 + djnz) = 5 * 3330 = 16650T
    ; Remaining: 17710 - 16650 = 1060T
    ; ld b,81 (7T) + djnz (80*13+8=1048T) = 1055T
    ; Add nop = 1059T (1T short)

    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $              ; 16650T
    ld b, 81            ; 7T
    djnz $              ; 1048T
    nop                 ; 4T
    ; Total: 17709T

    ; YELLOW in left border (T=0-23, ~48px)
    ld a, 6             ; 7T
    out ($fe), a        ; 11T - YELLOW on
    ; Left border is 24T = 48px, but we're already some T into it
    ; Keep yellow for ~20T
    ld b, 2             ; 7T
    djnz $              ; 21T
    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK
    ; ~61T for yellow block

    ; Now delay to right border (T=152)
    ; Current position in line: ~61T
    ; Target: T=152
    ; Delay: 152 - 61 = 91T
    ; ld b,7 (7T) + djnz (6*13+8=86T) = 93T

    ld b, 7             ; 7T
    djnz $              ; 86T
    ; 93T delay

    ; MAGENTA in right border
    ld a, 3             ; 7T
    out ($fe), a        ; 11T - MAGENTA on
    ; Right border is 24T = 48px
    ld b, 2             ; 7T
    djnz $              ; 21T
    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK
    ; ~61T for magenta block

    ; ============================================
    ; WHITE MARKER - Line 280, T=80 within line
    ; ============================================
    ; Current line position: ~152 + 93 + 61 = 306T (into next line)
    ; So we're at line 129, T=306-224=82
    ; Actually let me recalculate from absolute position
    ; After yellow/magenta we're at: 28672 + 61 + 93 + 61 = 28887T
    ; Line 128 ends at: 129 * 224 = 28896T
    ; So we're at line 128, T=28887-28672=215 (near end of line)
    ;
    ; Target for WHITE: T = 280 * 224 + 80 = 62800T
    ; Current: ~28887T
    ; Need delay: 62800 - 28887 = 33913T
    ;
    ; 10 x 3330 = 33300T
    ; Remaining: 33913 - 33300 = 613T
    ; ld b,47 (7T) + djnz (46*13+8=606T) = 613T exact!

    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 0
    djnz $              ; 33300T
    ld b, 47            ; 7T
    djnz $              ; 606T
    ; Total: 33913T

    ; WHITE marker - 32px wide
    ld a, 7             ; 7T
    out ($fe), a        ; 11T - WHITE on
    ld b, 3
    djnz $
    nop
    xor a               ; 4T
    out ($fe), a        ; 11T - BLACK

    ; Done with markers
    pop hl
    pop de
    pop bc
    pop af
    ei
    reti

main_loop:
    ei
    halt
    jp main_loop

    end start
