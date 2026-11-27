// nvram.js — the 24C16 I2C EEPROM (2KB) on SMUC, where the ProfROM keeps its
// settings. Bit by bit, a port of Xpeccy+'s libxpeccy/nvram.c (itself after
// UnrealSpeccy, which ProfROM is known to work with). SMUC's write-protect
// line is not modelled: the chip always takes the write.
//
// The host drives SDA and SCL (SMUC SYS #FFBA bits 4 and 6) and reads SDA
// back (SYS bit 6): what the chip puts there, or the host's own level.

export const NV_SIZE = 0x800;

const IDLE = 0, RCV_CMD = 1, RCV_ADR = 2, RCV_DATA = 3, SEND_DATA = 4, RD_ACK = 5;

export class Nvram24c16 {
    constructor() {
        this.mem = new Uint8Array(NV_SIZE);
        this.onChange = null;            // (mem) after a byte is written
        this.powerOn();
    }

    /** The bus comes up idle with both lines high; the contents stay */
    powerOn() {
        this.state = IDLE;
        this.adr = 0;
        this.datain = 0;
        this.dataout = 0;
        this.bitsin = 0;
        this.bitsout = 0;
        this.sda = 1;
        this.scl = 1;
        this.out = 1;
        this.outz = 1;
    }

    _load() {
        this.dataout = this.mem[this.adr];
        this.adr = (this.adr + 1) & (NV_SIZE - 1);
        this.bitsout = 0;
        this.state = SEND_DATA;
    }

    write(sda, scl) {
        sda = sda ? 1 : 0;
        scl = scl ? 1 : 0;
        if (scl !== this.scl) {
            if (scl) {                                   // rising SCL: the chip reads SDA
                if (this.state === RD_ACK) {
                    if (sda) { this.state = IDLE; this.outz = 1; }   // no ACK: read over
                    else this._load();                               // next byte out
                } else if (this.state === RCV_CMD || this.state === RCV_ADR || this.state === RCV_DATA) {
                    if (this.outz) {                     // not the chip's own ACK slot
                        this.datain = ((this.datain << 1) | sda) & 0xFF;
                        this.bitsin++;
                    }
                }
            } else {                                     // falling SCL: the chip sets SDA
                if (this.bitsin === 8) {                 // a byte in: take it and ACK
                    this.bitsin = 0;
                    switch (this.state) {
                        case RCV_CMD:
                            if ((this.datain & 0xF0) !== 0xA0) { this.state = IDLE; this.outz = 1; break; }
                            this.adr = (this.adr & 0xFF) | ((this.datain << 7) & 0x700);   // block
                            if (this.datain & 1) this._load();       // read from the current address
                            else this.state = RCV_ADR;
                            break;
                        case RCV_ADR:
                            this.adr = (this.adr & 0x700) | this.datain;
                            this.state = RCV_DATA;
                            break;
                        case RCV_DATA:
                            this.mem[this.adr] = this.datain;
                            this.adr = (this.adr & 0x7F0) | ((this.adr + 1) & 0x0F);  // 16-byte page
                            if (this.onChange) this.onChange(this.mem);
                            break;
                    }
                    if (this.state !== IDLE) { this.out = 0; this.outz = 0; }
                } else if (this.state === SEND_DATA) {
                    if (this.bitsout === 8) {
                        this.state = RD_ACK;
                        this.outz = 1;
                    } else {
                        this.out = (this.dataout & 0x80) ? 1 : 0;
                        this.dataout = (this.dataout << 1) & 0xFF;
                        this.bitsout++;
                        this.outz = 0;
                    }
                } else {
                    this.outz = 1;
                }
            }
        } else if (scl && sda !== this.sda) {            // SDA moved with SCL high
            this.state = sda ? IDLE : RCV_CMD;           // stop : start
            this.bitsin = 0;
            this.outz = 1;
        }
        if (this.outz) this.out = sda;
        this.sda = sda;
        this.scl = scl;
    }

    read() { return this.out; }
}
