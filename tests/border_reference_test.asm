    DEVICE ZXSPECTRUM48

; Border Timing Reference Test
; Tests border timing from non-contended memory ($8000)
;
; 48K Spectrum:
;   224 T-states/line, 312 lines/frame
;   Visible line: T=0-175 (352 pixels), h-blank: T=176-223
;
; Markers:
;   RED at line 32, 32px wide (top border, center)
;   BLUE at line 33, 32px wide (aligned with RED)
;   GREEN at line 100, starts at paper (no left border offset)
;   CYAN at line 101, X=8 to X=343 (reference for border edges)
;   YELLOW at line 128, left border only (~16px)
;   MAGENTA at line 128, right border only (~16px)
;   WHITE at line 280, 32px wide (bottom border, aligned with RED)
;
; TIMING NOTE:
;   Delay calibrated at 7176T for stable display
;   M8XXX matches Spectaculator (non-contended memory)
;
; Architecture: Minimal IM2 handler (just RET), drawing in main loop
;
; Assemble: sjasmplus border_reference_test.asm

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

    ei              ; enable interrupts once here
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
    ; RED - Line 32, T=86 (center)
    ; ==========================================
    ; Line 32 starts at: 32 * 224 = 7168T
    ; Want RED on at: 7168 + 86 = 7254T
    ; Current T: 33
    ; Need to reach: 7254 - 18 (ld a + out) = 7236T
    ; Delay needed: 7236 - 33 = 7203T
    ;
    ; 2 full loops = 6660T
    ; Remaining: 7203 - 6660 = 543T
    ; ld b,41 (7T) + djnz (40*13+8=528T) = 535T
    ; Add 2 nops (8T) = 543T exact

    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 6660T total
    ld b, 40
    djnz $              ; 522T (no NOPs)
    ; Total delay: 7182T
    ; Current T: 29 + 7182 = 7211T

    ; RED marker - 32px (16T visible)
    ld a, 2             ; 7T -> T=7212
    out ($fe), a        ; 11T -> T=7223, RED on (line 32, T=55)
    nop
    nop
    nop                 ; 12T delay
    xor a               ; 4T -> T=7239
    out ($fe), a        ; 11T -> T=7250, BLACK
    ; RED visible: 12 + 4 = 16T = 32px

    ; Add 224T (one scanline) after RED
    ld b, 16
    djnz $              ; 203T
    ld c, 0             ; 7T (dummy load)
    nop                 ; 4T -> 221T total
    ; Current T: 7471T

    ; ==========================================
    ; BLUE - Line 33, aligned with RED
    ; ==========================================
    ; After RED: T=7250
    ; Line 33 starts at: 33 * 224 = 7392T
    ; RED is at T=55 within line, so BLUE target: 7392 + 55 = 7447T
    ; Need to reach: 7447 - 18 = 7429T
    ; Delay needed: 7429 - 7250 = 179T
    ;
    ; ld b,13 (7T) + djnz (12*13+8=164T) = 171T
    ; Add 2 nops (8T) = 179T exact

    ld b, 13            ; 7T
    djnz $              ; 164T
    nop
    nop                 ; 8T
    ; Delay: 179T
    ; Current T: 7250 + 179 = 7429T

    ; BLUE marker - 40px (20T visible)
    ld a, 1             ; 7T -> T=7436
    out ($fe), a        ; 11T -> T=7447, BLUE on (line 33, T=55)
    nop
    nop
    nop
    nop                 ; 16T delay
    xor a               ; 4T
    out ($fe), a        ; 11T -> T=7478, BLACK
    ; BLUE visible: 16 + 4 = 20T = 40px

    ; ==========================================
    ; GREEN - Line 100, left border to right border
    ; ==========================================
    ; After BLUE: T=7474
    ; Line 100 starts at: 100 * 224 = 22400T
    ; Start GREEN 48T before paper (T=-48 within line, deep in left border)
    ; Need GREEN on at: 22352 - 18 = 22334T
    ; Delay needed: 22334 - 7474 = 14860T
    ;
    ; 4 full loops = 13320T
    ; Remaining: 14860 - 13320 = 1540T
    ; ld b,118 (7T) + djnz (117*13+8=1529T) = 1536T
    ; Add 1 nop (4T) = 1540T exact

    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 6660T
    ld b, 0
    djnz $              ; 9990T
    ld b, 0
    djnz $              ; 13320T
    ld b, 118
    djnz $              ; 1536T
    nop                 ; 4T
    ; Total delay: 14860T
    ; Current T: 7474 + 14860 = 22334T

    nop
    nop
    nop
    nop
    nop
    nop                 ; 24T
    ; Current T: 22358T

    ; GREEN marker - left border to right border (~144T = 288px)
    ld a, 4             ; 7T -> T=22365
    out ($fe), a        ; 11T -> T=22376, GREEN on (24T before paper)
    ; Keep GREEN for visible width
    ld b, 11
    djnz $              ; 138T
    nop
    nop                 ; 8T
    ; Delay: 146T
    xor a               ; 4T
    out ($fe), a        ; 11T -> T=22535, BLACK (in right border)
    ; GREEN visible: 146 + 4 = 150T = 300px

    ; Add 224T (one scanline) after GREEN
    ld b, 17
    djnz $              ; 223T
    nop                 ; 4T -> 227T total (close to 224T)

    ; 16T after GREEN
    nop
    nop
    nop
    nop                 ; 16T

    ; ==========================================
    ; CYAN - Line 101, X=8 to X=343 (reference line)
    ; ==========================================
    ; After GREEN: T=22569
    ; Line 101 starts at: 101 * 224 = 22624T
    ; X=8 means 4T from visible start
    ; If left border starts ~24T before paper (T=-24 to T=0), then X=0 is at T=-24
    ; X=8 = 4T after X=0 = T=-20 relative to paper = T=22624-20 = 22604T
    ; Target CYAN on: 22604 - 18 = 22586T
    ; Delay needed: 22586 - 22569 = 17T
    ;
    ; nop nop nop nop = 16T (1T short)
    ; ld b,2 (7T) + djnz (1*13+8=21T) = 28T (11T over)
    ; Just use 4 nops + 1 extra = impossible, use 4 nops

    nop
    nop
    nop                 ; 12T
    ; Delay: 12T
    ; Current T: 22573 + 12 = 22585T

    nop
    nop
    nop                 ; 12T
    ; Current T: 22597T

    ; CYAN marker - X=8 to X=343 (~284px)
    ld a, 5             ; 7T -> T=22604
    out ($fe), a        ; 11T -> T=22615, CYAN on
    ld b, 11
    djnz $              ; 138T (10*13+8)
    xor a               ; 4T
    out ($fe), a        ; 11T, CYAN off
    ; CYAN visible: 138 + 4 = 142T = 284px

    ; ==========================================
    ; YELLOW - Line 128, left border only
    ; ==========================================
    ; After CYAN: T=22763
    ; Line 128 starts at: 128 * 224 = 28672T
    ; User says: shift left 96px = 48T earlier
    ; New delay: 5906 - 48 = 5858T
    ;
    ; 1 full loop = 3330T
    ; Remaining: 5858 - 3330 = 2528T
    ; ld b,194 (7T) + djnz (193*13+8=2517T) = 2524T

    ld b, 0
    djnz $              ; 3330T
    ld b, 194
    djnz $              ; 2524T
    ; Total delay: 5854T
    ; Current T: 22759 + 5854 = 28613T

    ; Add 3 NOPs before YELLOW (12T)
    nop
    nop
    nop                 ; 12T
    ; Current T: 28613 + 12 = 28625T
    ; YELLOW on at: 28625 + 18 = 28643T

    ; YELLOW marker - left border only (very short)
    ld a, 6             ; 7T
    out ($fe), a        ; 11T -> T=28638, YELLOW on (left border)
    xor a               ; 4T -> T=28642
    out ($fe), a        ; 11T -> T=28653, BLACK
    ; YELLOW visible: 4T = 8px (stays in left border)

    ; ==========================================
    ; MAGENTA - Line 128, right border only
    ; ==========================================
    ; After YELLOW off: T=28650 (shifted earlier)
    ; Right border starts at T=152 within line (after 24T left + 128T paper)
    ; Line 128 T=160: 28672 + 160 = 28832T (8T into right border)
    ; Need to reach: 28832 - 18 = 28814T
    ; Delay needed: 28814 - 28650 = 164T
    ;
    ; ld b,8 (7T) + djnz (7*13+8=99T) + 3 nops (12T) = 118T

    ld b, 8             ; 7T
    djnz $              ; 99T
    nop
    nop
    nop                 ; 12T (added 2 NOPs = 8T)
    ; Delay: 118T
    ; Current T: 28644 + 118 = 28762T

    ; MAGENTA marker - right border only (very short)
    ld a, 3             ; 7T -> T=28769
    out ($fe), a        ; 11T -> T=28780, MAGENTA on (right border)
    xor a               ; 4T -> T=28802
    out ($fe), a        ; 11T -> T=28813, BLACK
    ; MAGENTA visible: 4T = 8px (stays in right border)

    ; ==========================================
    ; WHITE - Line 280, aligned with RED/BLUE
    ; ==========================================
    ; After MAGENTA: T=28841
    ; Line 280 starts at: 280 * 224 = 62720T
    ; RED appears at T=55 within line 32, WHITE should match
    ; Target: 62720 + 55 = 62775T
    ; Need WHITE on at: 62775 - 18 = 62757T
    ; Delay needed: 62757 - 28841 = 33916T
    ;
    ; 10 full loops = 33300T
    ; Remaining: 33916 - 33300 = 616T
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
    ld b, 45
    djnz $              ; 587T (44*13+8=580 + 7)
    ; Total delay: 33887T (removed ~26T)
    ; Current T: 28852 + 33887 = 62739T

    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop                 ; 52T
    ; Current T: 62791T

    ; WHITE marker - 32px (aligned with RED)
    ld a, 7             ; 7T -> T=62798
    out ($fe), a        ; 11T -> T=62809, WHITE on (line 280, T=89)
    nop
    nop
    nop                 ; 12T delay
    xor a               ; 4T
    out ($fe), a        ; 11T, BLACK
    ; WHITE visible: 12 + 4 = 16T = 32px

    jp main_loop

    ; end start
    SAVESNA "output_border_reference_test.sna", start
