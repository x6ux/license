-- License check (server-side). Add to a resource: server_script '@license-system/guard.lua'
-- (or paste it at the top of the resource's main server file)
local LICENSE_RESOURCE = 'license-system'
local CHECK_TIMEOUT = 30000 -- ms to wait for the license server reply
local CLOSE_DELAY = 8       -- seconds the error stays visible before the server closes

local function checkLicense()
    if GetResourceState(LICENSE_RESOURCE) ~= 'started' then
        return false
    end
    local ok, licensed = pcall(function()
        return exports[LICENSE_RESOURCE]:IsLicensed()
    end)
    return ok and licensed == true
end

local function failAndClose(reason)
    for i = CLOSE_DELAY, 1, -1 do
        print('^1==================================================^7')
        print('^1  LICENSE ERROR: ' .. reason .. '^7')
        print('^1  Resource: ' .. GetCurrentResourceName() .. '^7')
        print('^1  Server will close in ' .. i .. ' seconds...^7')
        print('^1==================================================^7')
        Wait(1000)
    end
    ExecuteCommand('quit')
end

CreateThread(function()
    local deadline = GetGameTimer() + CHECK_TIMEOUT
    while not checkLicense() do
        if GetGameTimer() > deadline then
            if GetResourceState(LICENSE_RESOURCE) ~= 'started' then
                return failAndClose(LICENSE_RESOURCE .. ' is not running (check server.cfg order)')
            end
            return failAndClose('license check failed (see the [License] error above)')
        end
        Wait(250)
    end
end)