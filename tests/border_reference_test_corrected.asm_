    DEVICE ZXSPECTRUM48

; Border Timing Reference Test - CORRECTED T-STATES
; Tests border timing from non-contended memory ($8000)
;
; 48K Spectrum:
;   224 T-states/line, 312 lines/frame, 69888 T-states/frame
;   Line structure: 24T left border + 128T paper + 24T right border + 48T h-blank = 224T
;
; Markers (designed for vertical alignment):
;   RED at line 32, 32px wide (top border)
;   BLUE at line 34, 32px wide (should align vertically with RED)
;   GREEN at line 100, ~300px wide (paper area reference)
;   CYAN at line 102, ~284px wide (paper area reference)
;   YELLOW at line 128, left border only (~8px)
;   MAGENTA at line 128, right border only (~8px)
;   WHITE at line 280, 32px wide (should align vertically with RED)
;
; TIMING: Late timing mode assumed (INT at frame boundary)
;   After HALT + INT(19T) + RET(10T) = T=29
;
; Architecture: Minimal IM2 handler (just RET), drawing in main loop
;
; Assemble: sjasmplus border_reference_test_corrected.asm

    org $8000

start:
    di
    ld a, $81
    ld i, a
    im 2

    ; Fill vector table at $8100-$81FF with $82
    ld hl, $8100
    ld de, $8101
    ld bc, 256
    ld (hl), $82
    ldir

    ei
    jp main_loop

    org $8282

im2_handler:
    ret
    ; Handler: 10T (ret)
    ; Total from INT: 19T (ack) + 10T (handler) = 29T

main_loop:
    ei
    halt                ; ei+halt is atomic - waits for INT
    ; After HALT + INT + handler return: T=29

    ; ==========================================
    ; RED - Line 32
    ; ==========================================
    ; Line 32 starts at: 32 * 224 = 7168T
    ; Target: RED centered at ~pixel 168 (lineT=84)
    ; Target frameT: 7168 + 84 = 7252T
    ; With ioOffset=8: need tStates = 7252 - 8 = 7244T at OUT
    ; Need tStates before LD A: 7244 - 7 = 7237T
    ; Delay needed: 7237 - 29 = 7208T
    ;
    ; Actual delay: 3330 + 3330 + 522 = 7182T
    ; This gives tStates at OUT: 29 + 7182 + 7 = 7218T

    ld b, 0
    djnz $              ; 7T + 255*13+8 = 3330T
    ld b, 0
    djnz $              ; 3330T, cumulative: 6660T
    ld b, 40
    djnz $              ; 7T + 39*13+8 = 522T, cumulative: 7182T
    ; Current T: 29 + 7182 = 7211T

    ; RED marker
    ld a, 2             ; 7T, T=7218
    out ($fe), a        ; 11T, T=7229, RED on
                        ; With ioOffset=8: frameT=7226, line 32, lineT=58, pixel=116
    nop
    nop
    nop                 ; 12T, T=7241
    xor a               ; 4T, T=7245
    out ($fe), a        ; 11T, T=7256, BLACK
                        ; With ioOffset=8: frameT=7253
    ; RED duration: 7253 - 7226 = 27T = 54px visible

    ; ==========================================
    ; Delay to BLUE - need exactly 2 scanlines (448T) for alignment
    ; ==========================================
    ; Current T: 7256
    ; For RED and BLUE to align vertically, BLUE ON should be at:
    ;   RED ON lineT + 2*224 = 7226 + 448 = 7674 frameT
    ;   So tStates at BLUE OUT = 7674 - 8 = 7666
    ; Delay needed: 7666 - 7256 - 7 (LD A) = 403T
    ;
    ; Using: 16-loop(210T) + 13-loop(178T) + 3 nops(12T) + 1 nop(4T) = 404T
    ; Adjusted: 16-loop(210T) + 14-loop(185T) + 2 nops(8T) = 403T

    ld b, 16
    djnz $              ; 7T + 15*13+8 = 210T, T=7466
    ld b, 14
    djnz $              ; 7T + 13*13+8 = 185T, T=7651
    nop
    nop                 ; 8T, T=7659
    ; Total delay: 210 + 185 + 8 = 403T
    ; Current T: 7256 + 403 = 7659T

    ; BLUE marker - aligned with RED
    ld a, 1             ; 7T, T=7666
    out ($fe), a        ; 11T, T=7677, BLUE on
                        ; With ioOffset=8: frameT=7674, line 34, lineT=58, pixel=116
    nop
    nop
    nop                 ; 12T, T=7689
    xor a               ; 4T, T=7693
    out ($fe), a        ; 11T, T=7704, BLACK
                        ; With ioOffset=8: frameT=7701
    ; BLUE duration: 7701 - 7674 = 27T = 54px visible (matches RED)

    ; ==========================================
    ; GREEN - Line 100, wide bar
    ; ==========================================
    ; Current T: 7704
    ; Line 100 starts at: 100 * 224 = 22400T
    ; Target: GREEN starting early in line, ~pixel 8 (lineT=4)
    ; Target frameT: 22400 + 4 = 22404T
    ; With ioOffset=8: need tStates = 22404 - 8 = 22396T at OUT
    ; Delay needed: 22396 - 7704 - 7 = 14685T
    ;
    ; 4 full loops = 13320T
    ; Remaining: 14685 - 13320 = 1365T
    ; ld b,105 (7T) + djnz (104*13+8=1360T) = 1367T (close)

    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T, cumulative: 6660T
    ld b, 0
    djnz $              ; 3330T, cumulative: 9990T
    ld b, 0
    djnz $              ; 3330T, cumulative: 13320T
    ld b, 103
    djnz $              ; 7T + 102*13+8 = 1341T
    nop
    nop
    nop                 ; 12T
    ; Total delay: 13320 + 1341 + 12 = 14673T
    ; Current T: 7704 + 14673 = 22377T

    ; GREEN marker
    ld a, 4             ; 7T, T=22384
    out ($fe), a        ; 11T, T=22395, GREEN on
                        ; With ioOffset=8: frameT=22392, line 100, lineT=8-ish
    ld b, 11
    djnz $              ; 7T + 10*13+8 = 145T, T=22540
    nop
    nop                 ; 8T, T=22548
    xor a               ; 4T, T=22552
    out ($fe), a        ; 11T, T=22563, BLACK
    ; GREEN duration: ~160T = ~320px

    ; ==========================================
    ; CYAN - Line 102
    ; ==========================================
    ; Current T: 22563
    ; Line 102 starts at: 102 * 224 = 22848T
    ; Target: CYAN at similar position to GREEN
    ; Target frameT: 22848 + 8 = 22856T
    ; Delay needed: 22856 - 22563 - 8 - 7 = 278T

    ld b, 21
    djnz $              ; 7T + 20*13+8 = 275T, T=22838
    nop                 ; 4T, T=22842

    ; CYAN marker
    ld a, 5             ; 7T, T=22849
    out ($fe), a        ; 11T, T=22860, CYAN on
    ld b, 11
    djnz $              ; 145T, T=23005
    xor a               ; 4T, T=23009
    out ($fe), a        ; 11T, T=23020, BLACK
    ; CYAN duration: ~160T = ~320px

    ; ==========================================
    ; YELLOW - Line 128, left border only
    ; ==========================================
    ; Current T: 23020
    ; Line 128 starts at: 128 * 224 = 28672T
    ; Target: YELLOW in left border, ~pixel 8 (lineT=4)
    ; Target frameT: 28672 + 4 = 28676T
    ; Delay needed: 28676 - 23020 - 8 - 7 = 5641T

    ld b, 0
    djnz $              ; 3330T, T=26350
    ld b, 178
    djnz $              ; 7T + 177*13+8 = 2316T, T=28666
    ; Total: 5646T (close enough)

    ; YELLOW marker - left border only
    ld a, 6             ; 7T, T=28673
    out ($fe), a        ; 11T, YELLOW on
    xor a               ; 4T
    out ($fe), a        ; 11T, BLACK
    ; YELLOW duration: 4T = 8px

    ; ==========================================
    ; MAGENTA - Line 128, right border only
    ; ==========================================
    ; Current T: ~28699
    ; Right border starts at lineT=152 (24+128=152)
    ; Target frameT: 28672 + 156 = 28828T
    ; Delay needed: 28828 - 28699 - 7 = 122T

    ld b, 9
    djnz $              ; 7T + 8*13+8 = 119T

    ; MAGENTA marker - right border only
    ld a, 3             ; 7T
    out ($fe), a        ; 11T, MAGENTA on
    xor a               ; 4T
    out ($fe), a        ; 11T, BLACK
    ; MAGENTA duration: 4T = 8px

    ; ==========================================
    ; WHITE - Line 280, aligned with RED/BLUE
    ; ==========================================
    ; Current T: ~28851
    ; Line 280 starts at: 280 * 224 = 62720T
    ; Target: WHITE at same lineT as RED (58), so frameT = 62720 + 58 = 62778T
    ; With ioOffset=8: need tStates = 62778 - 8 = 62770T
    ; Delay needed: 62770 - 28851 - 7 = 33912T
    ;
    ; 10 full loops = 33300T
    ; Remaining: 33912 - 33300 = 612T
    ; ld b,47 (7T) + djnz (46*13+8=606T) = 613T

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
    ld b, 47
    djnz $              ; 613T
    ; Total: 33913T

    ; WHITE marker - aligned with RED
    ld a, 7             ; 7T
    out ($fe), a        ; 11T, WHITE on
    nop
    nop
    nop                 ; 12T
    xor a               ; 4T
    out ($fe), a        ; 11T, BLACK
    ; WHITE duration: 27T = 54px (matches RED/BLUE)

    jp main_loop

    SAVESNA "border_reference_test_corrected.sna", start
