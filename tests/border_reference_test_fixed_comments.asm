    DEVICE ZXSPECTRUM48

; Border Timing Reference Test - FIXED COMMENTS
; Tests border timing from non-contended memory ($8000)
;
; 48K Spectrum:
;   224 T-states/line, 312 lines/frame, 69888 T-states/frame
;
; Architecture: Minimal IM2 handler (just RET), drawing in main loop
;
; Assemble: sjasmplus border_reference_test_fixed_comments.asm

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
    ; Handler: 10T (RET)
    ; Total from INT: 19T (IM2 ack) + 10T (RET) = 29T

main_loop:
    ei
    halt                ; ei+halt is atomic - waits for INT
    ; After HALT + INT + handler return: T=29

    ; ==========================================
    ; RED - Line 32
    ; ==========================================
    ; Line 32 starts at: 32 * 224 = 7168T

    ld b, 0
    djnz $              ; 7T + 255*13+8 = 3330T, T=3359
    ld b, 0
    djnz $              ; 3330T, T=6689
    ld b, 40
    djnz $              ; 7T + 39*13+8 = 522T, T=7211
    ; Total delay: 3330 + 3330 + 522 = 7182T
    ; Current T: 29 + 7182 = 7211T

    ; RED marker
    ld a, 2             ; 7T, T=7218
    out ($fe), a        ; 11T, T=7229, RED on
                        ; Line 32, lineT = 7229-7168 = 61T, pixel ~122
    nop                 ; 4T, T=7233
    nop                 ; 4T, T=7237
    nop                 ; 4T, T=7241
    xor a               ; 4T, T=7245
    out ($fe), a        ; 11T, T=7256, BLACK
    ; RED visible (between OUT calls): 7245-7218 = 27T = 54px

    ; Scanline delay after RED
    ld b, 16
    djnz $              ; 7T + 15*13+8 = 210T, T=7466
    ld c, 0             ; 7T, T=7473
    nop                 ; 4T, T=7477
    ; Delay: 7+203+7+4 = 221T (NOT 224T - 3T short of one scanline)
    ; Current T: 7256 + 221 = 7477T

    ; ==========================================
    ; BLUE - Line 34 (2 lines after RED due to timing)
    ; ==========================================
    ; Current T: 7477T (not 7250 as old comment said)
    ; Line 34 starts at: 34 * 224 = 7616T

    ld b, 13            ; 7T, T=7484
    djnz $              ; 12*13+8 = 164T, T=7648
    nop                 ; 4T, T=7652
    nop                 ; 4T, T=7656
    ; Delay: 7+164+8 = 179T
    ; Current T: 7477 + 179 = 7656T

    ; BLUE marker
    ld a, 1             ; 7T, T=7663
    out ($fe), a        ; 11T, T=7674, BLUE on
                        ; Line 34, lineT = 7674-7616 = 58T, pixel ~116
    nop                 ; 4T, T=7678
    nop                 ; 4T, T=7682
    nop                 ; 4T, T=7686
    nop                 ; 4T, T=7690
    xor a               ; 4T, T=7694
    out ($fe), a        ; 11T, T=7705, BLACK
    ; BLUE visible (between OUT calls): 7694-7663 = 31T = 62px

    ; ==========================================
    ; GREEN - Line 101
    ; ==========================================
    ; Current T: 7705T
    ; Line 100 starts at: 100 * 224 = 22400T
    ; Line 101 starts at: 101 * 224 = 22624T

    ld b, 0
    djnz $              ; 3330T, T=11035
    ld b, 0
    djnz $              ; 3330T, T=14365
    ld b, 0
    djnz $              ; 3330T, T=17695
    ld b, 0
    djnz $              ; 3330T, T=21025
    ld b, 118
    djnz $              ; 7T + 117*13+8 = 1536T, T=22561
    nop                 ; 4T, T=22565
    ; Total delay: 4*3330 + 1536 + 4 = 14860T
    ; Current T: 7705 + 14860 = 22565T

    nop                 ; 4T, T=22569
    nop                 ; 4T, T=22573
    nop                 ; 4T, T=22577
    nop                 ; 4T, T=22581
    nop                 ; 4T, T=22585
    nop                 ; 4T, T=22589
    ; 6 NOPs = 24T
    ; Current T: 22565 + 24 = 22589T

    ; GREEN marker
    ld a, 4             ; 7T, T=22596
    out ($fe), a        ; 11T, T=22607, GREEN on
                        ; Line 101, lineT = 22607-22624 = -17T (before line start)
                        ; Actually in line 100, lineT = 22607-22400 = 207T
    ld b, 11
    djnz $              ; 7T + 10*13+8 = 145T, T=22752
    nop                 ; 4T, T=22756
    nop                 ; 4T, T=22760
    xor a               ; 4T, T=22764
    out ($fe), a        ; 11T, T=22775, BLACK
    ; GREEN visible: 22764-22596 = 168T = 336px

    ; Scanline delay after GREEN
    ld b, 17
    djnz $              ; 7T + 16*13+8 = 223T, T=22998
    nop                 ; 4T, T=23002
    ; Delay: 227T
    ; Current T: 22775 + 227 = 23002T

    nop                 ; 4T, T=23006
    nop                 ; 4T, T=23010
    nop                 ; 4T, T=23014
    nop                 ; 4T, T=23018
    ; 4 NOPs = 16T
    ; Current T: 23002 + 16 = 23018T

    ; ==========================================
    ; CYAN - Line 103
    ; ==========================================
    ; Current T: 23018T
    ; Line 103 starts at: 103 * 224 = 23072T

    nop                 ; 4T, T=23022
    nop                 ; 4T, T=23026
    nop                 ; 4T, T=23030
    ; 3 NOPs = 12T
    ; Current T: 23018 + 12 = 23030T

    nop                 ; 4T, T=23034
    nop                 ; 4T, T=23038
    nop                 ; 4T, T=23042
    ; 3 NOPs = 12T
    ; Current T: 23030 + 12 = 23042T

    ; CYAN marker
    ld a, 5             ; 7T, T=23049
    out ($fe), a        ; 11T, T=23060, CYAN on
                        ; Line 103, lineT = 23060-23072 = -12T (before line start)
                        ; Actually in line 102, lineT = 23060-22848 = 212T
    ld b, 11
    djnz $              ; 145T, T=23205
    xor a               ; 4T, T=23209
    out ($fe), a        ; 11T, T=23220, CYAN off
    ; CYAN visible: 23209-23049 = 160T = 320px

    ; ==========================================
    ; YELLOW - Line 130
    ; ==========================================
    ; Current T: 23220T
    ; Line 128 starts at: 128 * 224 = 28672T
    ; Line 130 starts at: 130 * 224 = 29120T

    ld b, 0
    djnz $              ; 3330T, T=26550
    ld b, 194
    djnz $              ; 7T + 193*13+8 = 2524T, T=29074
    ; Total delay: 3330 + 2524 = 5854T
    ; Current T: 23220 + 5854 = 29074T

    nop                 ; 4T, T=29078
    nop                 ; 4T, T=29082
    nop                 ; 4T, T=29086
    ; 3 NOPs = 12T
    ; Current T: 29074 + 12 = 29086T

    ; YELLOW marker - left border
    ld a, 6             ; 7T, T=29093
    out ($fe), a        ; 11T, T=29104, YELLOW on
                        ; Line 130, lineT = 29104-29120 = -16T (before line start)
                        ; Actually in line 129, lineT = 29104-28896 = 208T
    xor a               ; 4T, T=29108
    out ($fe), a        ; 11T, T=29119, BLACK
    ; YELLOW visible: 4T = 8px

    ; ==========================================
    ; MAGENTA - Line 130
    ; ==========================================
    ; Current T: 29119T

    ld b, 8             ; 7T, T=29126
    djnz $              ; 7*13+8 = 99T, T=29225
    nop                 ; 4T, T=29229
    nop                 ; 4T, T=29233
    nop                 ; 4T, T=29237
    ; Delay: 7+99+12 = 118T
    ; Current T: 29119 + 118 = 29237T

    ; MAGENTA marker - right border
    ld a, 3             ; 7T, T=29244
    out ($fe), a        ; 11T, T=29255, MAGENTA on
                        ; Line 130, lineT = 29255-29120 = 135T
    xor a               ; 4T, T=29259
    out ($fe), a        ; 11T, T=29270, BLACK
    ; MAGENTA visible: 4T = 8px

    ; ==========================================
    ; WHITE - Line 282
    ; ==========================================
    ; Current T: 29270T
    ; Line 280 starts at: 280 * 224 = 62720T
    ; Line 282 starts at: 282 * 224 = 63168T

    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T
    ld b, 0
    djnz $              ; 3330T, cumulative: 33300T, T=62570
    ld b, 45
    djnz $              ; 7T + 44*13+8 = 587T, T=63157
    ; Total delay: 33300 + 587 = 33887T
    ; Current T: 29270 + 33887 = 63157T

    nop                 ; 4T, T=63161
    nop                 ; 4T, T=63165
    nop                 ; 4T, T=63169
    nop                 ; 4T, T=63173
    nop                 ; 4T, T=63177
    nop                 ; 4T, T=63181
    nop                 ; 4T, T=63185
    nop                 ; 4T, T=63189
    nop                 ; 4T, T=63193
    nop                 ; 4T, T=63197
    nop                 ; 4T, T=63201
    nop                 ; 4T, T=63205
    nop                 ; 4T, T=63209
    ; 13 NOPs = 52T
    ; Current T: 63157 + 52 = 63209T

    ; WHITE marker
    ld a, 7             ; 7T, T=63216
    out ($fe), a        ; 11T, T=63227, WHITE on
                        ; Line 282, lineT = 63227-63168 = 59T, pixel ~118
    nop                 ; 4T, T=63231
    nop                 ; 4T, T=63235
    nop                 ; 4T, T=63239
    xor a               ; 4T, T=63243
    out ($fe), a        ; 11T, T=63254, BLACK
    ; WHITE visible: 63243-63216 = 27T = 54px

    jp main_loop

    SAVESNA "border_reference_test_fixed_comments.sna", start
