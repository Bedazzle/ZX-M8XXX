; RZX Sync Test - Keyboard Port Oscillogram
; Compare interrupt timing across emulators
;
; Reads keyboard port $EFFE (keys 0,9,8,7,6) at each interrupt
; and writes the value to screen memory sequentially.
;
; SjASMPlus compatible - compile with: sjasmplus rzx-sync-test.asm
; Outputs: rzx-sync-test.sna

        DEVICE ZXSPECTRUM48

        ORG $8000

START:
        DI                      ; Disable interrupts first

        ; === Setup IM2 vector table at $BE00 (below $C000 for 128K) ===
        LD HL, $BE00
        LD DE, $BE01
        LD BC, 256
        LD (HL), $BD            ; Vector points to $BDBD
        LDIR

        ; === Place JP instruction at $BDBD ===
        LD A, $C3               ; JP opcode
        LD ($BDBD), A
        LD HL, INT_HANDLER
        LD ($BDBE), HL

        ; === Set I register for table at $BE00 ===
        LD A, $BE
        LD I, A

        ; === Initialize attribute pointer ===
        LD HL, $5800
        LD (SCREEN_PTR), HL

        ; === Clear screen pixels ===
        LD HL, $4000
        LD DE, $4001
        LD BC, 6143
        LD (HL), $00
        LDIR

        ; === Draw grid lines (first 256 bytes of each third = $08) ===
        ; This creates visible markers at thirds boundaries
        LD HL, $4000            ; First third
        LD DE, $4001
        LD BC, 255
        LD (HL), $08
        LDIR

        LD HL, $4800            ; Second third
        LD DE, $4801
        LD BC, 255
        LD (HL), $08
        LDIR

        LD HL, $5000            ; Third third
        LD DE, $5001
        LD BC, 255
        LD (HL), $08
        LDIR

        ; === Set attributes to bright white ===
        LD HL, $5800
        LD DE, $5801
        LD BC, 767
        LD (HL), $47            ; BRIGHT + white INK (visible)
        LDIR

        ; === Sync to first interrupt using IM1 + HALT ===
        IM 1
        EI
        HALT                    ; Waits for interrupt, syncs us

        ; === Now switch to IM2 for our handler ===
        IM 2
        EI

        ; === Main loop - just spin ===
MAIN_LOOP:
        JR MAIN_LOOP


; =============================================
; Interrupt Handler - called 50 times/second
; =============================================
INT_HANDLER:
        PUSH AF
        PUSH HL
        PUSH BC

        ; Get current attribute pointer first
        LD HL, (SCREEN_PTR)

        ; Check if we've reached end of attributes ($5B00)
        LD A, H
        CP $5B
        JR NC, SKIP_WRITE       ; Don't write past attribute area

        ; Read keyboard port $EFFE (row: 0 9 8 7 6)
        ; High byte $EF = 11101111 selects this row
        ; Bit 0 = "0", Bit 1 = "9", Bit 2 = "8", Bit 3 = "7", Bit 4 = "6"
        ; Bits are 0 when key pressed, 1 when not pressed
        LD BC, $EFFE
        IN A, (C)               ; A = keyboard state from port $EFFE

        ; Mask to keyboard bits only (0-4)
        AND $1F                 ; Keep only bits 0-4 (value $00-$1F)

        ; Lookup color in table
        PUSH HL
        LD HL, COLOR_TABLE
        LD D, 0
        LD E, A
        ADD HL, DE
        LD A, (HL)              ; A = attribute (BRIGHT + INK color)
        POP HL

        ; Write byte to screen
        LD (HL), A

        ; Increment pointer for next interrupt
        INC HL
        LD (SCREEN_PTR), HL

SKIP_WRITE:
        POP BC
        POP HL
        POP AF
        EI
        RETI


; =============================================
; Variables
; =============================================
SCREEN_PTR:
        DW $5800                ; Current write position (attribute area)

; =============================================
; Color lookup table (32 bytes, indexed by port value after AND $1F)
; Port values:
;   $1F (11111) = no key  -> white
;   $0F (01111) = key 6   -> blue
;   $17 (10111) = key 7   -> red
;   $1B (11011) = key 8   -> magenta
;   $1D (11101) = key 9   -> green
;   $1E (11110) = key 0   -> cyan
; All other values (multiple keys) -> black
; Value stored is BRIGHT ($40) + PAPER color (bits 3-5)
; Pixels are 0, so we see PAPER color as solid squares
; =============================================
COLOR_TABLE:
        DEFB $40                ; $00: PAPER black (multiple keys)
        DEFB $40                ; $01: PAPER black
        DEFB $40                ; $02: PAPER black
        DEFB $40                ; $03: PAPER black
        DEFB $40                ; $04: PAPER black
        DEFB $40                ; $05: PAPER black
        DEFB $40                ; $06: PAPER black
        DEFB $40                ; $07: PAPER black
        DEFB $40                ; $08: PAPER black
        DEFB $40                ; $09: PAPER black
        DEFB $40                ; $0A: PAPER black
        DEFB $40                ; $0B: PAPER black
        DEFB $40                ; $0C: PAPER black
        DEFB $40                ; $0D: PAPER black
        DEFB $40                ; $0E: PAPER black
        DEFB $48                ; $0F: key 6 - PAPER BLUE
        DEFB $40                ; $10: PAPER black
        DEFB $40                ; $11: PAPER black
        DEFB $40                ; $12: PAPER black
        DEFB $40                ; $13: PAPER black
        DEFB $40                ; $14: PAPER black
        DEFB $40                ; $15: PAPER black
        DEFB $40                ; $16: PAPER black
        DEFB $50                ; $17: key 7 - PAPER RED
        DEFB $40                ; $18: PAPER black
        DEFB $40                ; $19: PAPER black
        DEFB $40                ; $1A: PAPER black
        DEFB $58                ; $1B: key 8 - PAPER MAGENTA
        DEFB $40                ; $1C: PAPER black
        DEFB $60                ; $1D: key 9 - PAPER GREEN
        DEFB $68                ; $1E: key 0 - PAPER CYAN
        DEFB $78                ; $1F: no key - PAPER WHITE

; =============================================
; Save SNA snapshot
; =============================================
        SAVESNA "rzx-sync-test.sna", START