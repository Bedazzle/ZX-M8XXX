; Border Timing Full Frame Test
; Outputs markers at many lines throughout the frame
; Shows accumulated drift clearly
;
; Assemble with: sjasmplus border_timing_fullframe.asm --raw=border_timing_fullframe.bin

    org $8000

start:
    di

    ; Setup IM2 with I=$FE, handler at $8080
    ld a, $FE
    ld i, a
    im 2

    ; Fill vector table
    ld hl, $FE00
    ld de, $FE01
    ld bc, 256
    ld (hl), $80
    ldir

    jp main_loop

    org $8080

im2_handler:
    push af
    push bc
    push de

    ; We'll output markers every 32 lines from line 32 to line 224
    ; Each marker at same calculated X position
    ; If there's drift, markers won't align vertically

    ; Line 32: delay ~7168T from INT (32 * 224)
    ld b, 0
    djnz $           ; 3323T
    ld b, 0
    djnz $           ; 3323T
    ; ~6646T, need ~522T more
    ld b, 40
    djnz $           ; 515T

    ; Marker at line 32 - RED
    ld a, 2
    out ($fe), a
    ld b, 3
    djnz $           ; ~34T
    xor a
    out ($fe), a

    ; Gap to line 64 (32 lines = 7168T)
    ; We used ~60T for marker, need ~7108T
    ld b, 0
    djnz $           ; 3323T
    ld b, 0
    djnz $           ; 3323T
    ; ~6646T, need ~462T
    ld b, 36
    djnz $           ; 463T

    ; Marker at line 64 - BLUE
    ld a, 1
    out ($fe), a
    ld b, 3
    djnz $
    xor a
    out ($fe), a

    ; Gap to line 96
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; Marker at line 96 - MAGENTA
    ld a, 3
    out ($fe), a
    ld b, 3
    djnz $
    xor a
    out ($fe), a

    ; Gap to line 128
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; Marker at line 128 - GREEN
    ld a, 4
    out ($fe), a
    ld b, 3
    djnz $
    xor a
    out ($fe), a

    ; Gap to line 160
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; Marker at line 160 - CYAN
    ld a, 5
    out ($fe), a
    ld b, 3
    djnz $
    xor a
    out ($fe), a

    ; Gap to line 192
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; Marker at line 192 - YELLOW
    ld a, 6
    out ($fe), a
    ld b, 3
    djnz $
    xor a
    out ($fe), a

    ; Gap to line 224
    ld b, 0
    djnz $
    ld b, 0
    djnz $
    ld b, 36
    djnz $

    ; Marker at line 224 - WHITE
    ld a, 7
    out ($fe), a
    ld b, 3
    djnz $
    xor a
    out ($fe), a

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
