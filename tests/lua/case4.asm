      LUA PASS1
        function strip_speechmarks(s)
          if string.sub(s, 1, 1) == '"' and string.sub(s, #s, #s) == '"' then
            return string.sub(s, 2, #s - 1)
          end
          return s
        end
      ENDLUA

    MACRO LUA.BinToTap input_file?, output_file?, zx_name?, load_addr?
__saved_org = $
      ORG 0
      LUA ALLPASS
        local in_file = sj.get_define("input_file?", true)
        local out_file = sj.get_define("output_file?", true)
        local zx_name = strip_speechmarks(sj.get_define("zx_name?", true))
        if #zx_name < 10 then
          zx_name = string.sub(zx_name .. "          ", 1, 10)
        end
        local load_addr = _c(sj.get_define("load_addr?", true))
        local fname = strip_speechmarks(in_file)
        print("in_file=[" .. tostring(in_file) .. "] fname=[" .. tostring(fname) .. "]")
        local f = io.open(fname, "rb")
        print("opened=" .. tostring(f ~= nil))
        if f ~= nil then
          local file_len = f.seek(f, "end")
          f.close(f)
          print("len=" .. file_len .. " name=[" .. zx_name .. "] addr=" .. load_addr)
          _pl(" TAPOUT " .. out_file .. ", 0")
          _pl(' DB 3, "' .. zx_name .. '"')
          _pl(" DW " .. file_len .. ", " .. load_addr .. ", 32768")
          _pl(" TAPEND")
        end
      ENDLUA
      ORG __saved_org
    ENDM

    ORG $8000
    LUA.BinToTap "code.bin", "out.tap", "mycode", $8000
