;
;  "lua_scripts" ver.0.1	copyright (c) 2023 introspec
;
;  various operations that cannot be done in sjasmplus neatly
;

			LUA PASS1
				--; we want the pure string, but sjasmplus gives us a string with speechmarks
				--; writing the string without speechmarks would work, but looks ugly.
				--; hence, we remove them here, to make assembly source look neater.
				function strip_speechmarks(s)
					if string.sub(s, 1, 1) == '"' and string.sub(s, #s, #s) == '"' then
						return string.sub(s, 2, #s - 1)
					end
					return s
				end

				function win_slashes(s)
					return s:gsub("/", "\\")
				end
			ENDLUA

		MACRO LUA.RemoveFile file_path?
			LUA PASS3
				local file = strip_speechmarks(sj.get_define("file_path?", true))
				--; this removes file quietly, should work both on windows and unix
				--; and won't complain if the file is not there
				os.remove(file)
			ENDLUA
		ENDM

		MACRO LUA.SaveIfSuccessful file_path?, begin?, end?, message?
			IF _ERRORS = 0
				SAVEBIN	file_path?, begin?, end?-begin?
				DISPLAY	message?
			ELSE
				LUA.RemoveFile file_path?
			ENDIF
		ENDM

		MACRO LUA.BinToTap input_file?, output_file?, zx_name?, load_addr?
!__saved_org = $
			ORG 0
			LUA ALLPASS
				--; processng of input values
				local in_file = sj.get_define("input_file?", true)
				local out_file = sj.get_define("output_file?", true)
				local zx_name = strip_speechmarks(sj.get_define("zx_name?", true))
				if #zx_name < 10 then
					zx_name = string.sub(zx_name .. "          ", 1, 10)
				end
				local load_addr = _c(sj.get_define("load_addr?", true))
				--; determine the input file length
				local f = io.open(strip_speechmarks(in_file), "rb")
				if f ~= nil then
					local file_len = f.seek(f, "end")
					f.close(f)
					--; generate the tape file
					_pl(" EMPTYTAP" .. out_file)
					_pl(" TAPOUT " .. out_file .. ", 0") --; file header
					_pl(' DB 3, "' .. zx_name .. '"') --; file type and name
					_pl(" DW " .. file_len .. ", " .. load_addr .. ", 32768")
					_pl(" TAPEND")
					_pl(" TAPOUT " .. out_file) --; data section
					--; _pl(" INCBIN " .. win_slashes(in_file))
					_pl(" INCBIN " .. in_file)
					--;print(" INCBIN " .. in_file)
					--;local p = io.popen("cd")
					--;print(p.read(p))
					_pl(" TAPEND")
				end
			ENDLUA
			ORG __saved_org
		ENDM

		MACRO LUA.ExportPageDev page_id?, file?, free_mem?
			LUA ALLPASS
				local page_id = sj.get_define("page_id?", true)		--; sting for the current page
				local file = sj.get_define("file?", true)		--; file path for the output file
				local addr_begin = _c(page_id .. "_BEGIN")		--; where useful data begins
				local addr_end = _c(page_id .. "_END")			--; where useful data ends
				local raw_size = addr_end - addr_begin
				local free_mem = _c(sj.get_define("free_mem?", true))	--; remaining ram in the page
				local page_present
				if sj.error_count == 0 and raw_size > 0 then
					_pl("@" .. page_id .. "_RAW_SIZE EQU " .. raw_size)	--; variable @PAGEx_RAW_SIZE contains the page size
					_pl(" EXPORT " .. page_id .. "_RAW_SIZE")
					_pl(" EXPORT " .. page_id .. "_BEGIN")		--; the loading address for the current page
					_pl(" SAVEBIN " .. file .. ", " .. addr_begin .. ", " .. raw_size)
					_pl(' DISPLAY "* PAGE ' .. string.sub(page_id, #page_id, #page_id) .. ': ", /D, ' .. free_mem .. ', " bytes free"')
					page_present = "1"
				else
					os.remove(strip_speechmarks(file))
					page_present = "0"
				end
				_pl("@" .. page_id .. "_PRESENT = " .. page_present)	--; update binary flag @PAGEx_PRESENT
			ENDLUA
		ENDM

		MACRO LUA.ExportAsset label?, file?
			LUA ALLPASS
				--; _pl(" EXPORT " .. sj.get_define("label?", true))
				local file = sj.get_define("file?", true)
				local addr_begin = sj.get_define("label?", true)
				_pl(" SAVEBIN " .. file .. ", " .. addr_begin .. ", $-" .. addr_begin)
			ENDLUA
		ENDM
