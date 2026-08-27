local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local ltn12 = require("ltn12")
local http = require("socket.http")
local logger = require("logger")
local _ = require("gettext")

if not Device:isKindle() then
    return { disabled = true, }
end

local DEFAULT_INTERVAL_MINUTES = 10
local DATA_DIR = "/mnt/us/token-on-kindle"
local OUTPUT_FILE = DATA_DIR .. "/dashboard.png"
local URL_FILE = DATA_DIR .. "/url"
local INTERVAL_FILE = DATA_DIR .. "/interval_minutes"
local BACKGROUND_FLAG = DATA_DIR .. "/background-enabled"
local HELPER_DIR = "/mnt/us/extensions/token-on-kindle"
local HELPER_ENABLE = HELPER_DIR .. "/bin/enable.sh"
local HELPER_DISABLE = HELPER_DIR .. "/bin/disable.sh"
local HELPER_START = HELPER_DIR .. "/bin/start.sh"
local HELPER_MIRROR = HELPER_DIR .. "/bin/mirror-linkss.sh"
local HELPER_PID = DATA_DIR .. "/scheduler.pid"
local HELPER_LOG = DATA_DIR .. "/scheduler.log"
local LINKSS_DIR = "/mnt/us/linkss/screensavers"

local TokenOnKindle = WidgetContainer:extend{
    name = "token_on_kindle",
    is_doc_only = false,
    settings = nil,
    syncing = false,
    last_error = nil,
}

local function isFile(path)
    return lfs.attributes(path, "mode") == "file"
end

local function isDirectory(path)
    return lfs.attributes(path, "mode") == "directory"
end

local function ensureDirectory(path)
    if isDirectory(path) then
        return true
    end
    return lfs.mkdir(path) ~= nil
end

local function readTextFile(path)
    local file = io.open(path, "r")
    if not file then
        return nil
    end
    local value = file:read("*all")
    file:close()
    if not value then
        return nil
    end
    return value:gsub("%s+$", "")
end

local function writeTextFile(path, value)
    local temporary = path .. ".part"
    local file, open_error = io.open(temporary, "w")
    if not file then
        return nil, open_error
    end
    file:write(tostring(value or ""), "\n")
    file:close()
    local renamed, rename_error = os.rename(temporary, path)
    if not renamed then
        os.remove(temporary)
        return nil, rename_error
    end
    return true
end

local function readPngSignature(path)
    local file = io.open(path, "rb")
    if not file then
        return nil
    end
    local signature = file:read(8)
    file:close()
    return signature
end

local function isPng(path)
    return readPngSignature(path) == "\137PNG\13\10\26\10"
end

local function processIsAlive(pid)
    pid = tonumber(pid)
    if not pid or pid < 2 then
        return false
    end
    return os.execute("kill -0 " .. tostring(pid) .. " >/dev/null 2>&1") == 0
end

function TokenOnKindle:init()
    self.ui.menu:registerToMainMenu(self)
    ensureDirectory(DATA_DIR)

    self.settings = LuaSettings:open(
        DataStorage:getSettingsDir() .. "/token_on_kindle.lua"
    )

    if self.settings:hasNot("url") then
        self.settings:saveSetting("url", "")
    end
    if self.settings:hasNot("interval_minutes") then
        self.settings:saveSetting("interval_minutes", DEFAULT_INTERVAL_MINUTES)
    end
    if self.settings:hasNot("use_sleep_screen") then
        self.settings:makeTrue("use_sleep_screen")
    end
    self.settings:flush()

    self:syncHelperConfig()

    if self.settings:isTrue("use_sleep_screen") and isPng(OUTPUT_FILE) then
        self:applyKoreaderSleepScreen(false)
    end

    if isFile(BACKGROUND_FLAG) and isFile(HELPER_START) then
        os.execute("/bin/sh " .. HELPER_START .. " >/dev/null 2>&1 &")
    end
end

function TokenOnKindle:getUrl()
    return self.settings:readSetting("url", "") or ""
end

function TokenOnKindle:getIntervalMinutes()
    local minutes = tonumber(self.settings:readSetting(
        "interval_minutes",
        DEFAULT_INTERVAL_MINUTES
    )) or DEFAULT_INTERVAL_MINUTES
    if minutes < 5 then
        minutes = 5
    end
    return math.floor(minutes)
end

function TokenOnKindle:syncHelperConfig()
    ensureDirectory(DATA_DIR)
    local ok, error_message = writeTextFile(URL_FILE, self:getUrl())
    if not ok then
        logger.warn("TokenOnKindle: could not write helper URL:", error_message)
    end
    ok, error_message = writeTextFile(INTERVAL_FILE, self:getIntervalMinutes())
    if not ok then
        logger.warn("TokenOnKindle: could not write helper interval:", error_message)
    end
end

function TokenOnKindle:showMessage(message, timeout)
    UIManager:show(InfoMessage:new{
        text = message,
        timeout = timeout,
    })
end

function TokenOnKindle:applyKoreaderSleepScreen(show_result)
    if not Device:supportsScreensaver() then
        if show_result then
            self:showMessage(_("This Kindle does not allow KOReader to replace the sleep screen. Check Special Offers / native screensaver settings."))
        end
        return false
    end

    G_reader_settings:saveSetting("screensaver_type", "document_cover")
    G_reader_settings:saveSetting("screensaver_document_cover", OUTPUT_FILE)
    G_reader_settings:saveSetting("screensaver_img_background", "black")
    G_reader_settings:makeFalse("screensaver_show_message")
    G_reader_settings:makeFalse("screensaver_rotate_auto_for_best_fit")
    G_reader_settings:makeFalse("screensaver_stretch_images")
    G_reader_settings:flush()

    if show_result then
        self:showMessage(_("Token on Kindle is now the KOReader sleep screen."), 3)
    end
    return true
end

function TokenOnKindle:mirrorToLinkss()
    if not isDirectory(LINKSS_DIR) or not isFile(HELPER_MIRROR) then
        return
    end
    local result = os.execute(
        "/bin/sh " .. HELPER_MIRROR .. " " .. OUTPUT_FILE .. " >/dev/null 2>&1"
    )
    if result ~= 0 then
        logger.warn("TokenOnKindle: linkss mirror helper failed:", result)
    end
end

function TokenOnKindle:downloadDashboard(show_result)
    if self.syncing then
        if show_result then
            self:showMessage(_("A Token on Kindle refresh is already running."), 2)
        end
        return
    end

    local url = self:getUrl()
    if url == "" then
        if show_result then
            self:showMessage(_("Set the Token on Kindle dashboard URL first."))
        end
        return
    end

    self.syncing = true
    local temporary_file = OUTPUT_FILE .. ".part"
    os.remove(temporary_file)

    local file, open_error = io.open(temporary_file, "wb")
    if not file then
        self.syncing = false
        self.last_error = tostring(open_error)
        if show_result then
            self:showMessage(_("Could not open the temporary image file."))
        end
        return
    end

    http.TIMEOUT = 25
    local request_ok, ok, code, response_headers, status = pcall(http.request, {
        url = url,
        sink = ltn12.sink.file(file),
        redirect = true,
        headers = {
            ["Cache-Control"] = "no-cache",
            ["User-Agent"] = "KOReader Token-on-Kindle/0.2",
        },
    })
    pcall(function() file:close() end)

    local success = request_ok and ok ~= nil and tonumber(code) == 200
    if not request_ok then
        status = tostring(ok)
    end
    if success and not isPng(temporary_file) then
        success = false
        status = _("The downloaded file is not a PNG image.")
    end

    if success then
        local renamed, rename_error = os.rename(temporary_file, OUTPUT_FILE)
        if not renamed then
            success = false
            status = tostring(rename_error)
        end
    end

    if success then
        local now = os.time()
        self.last_error = nil
        self.settings:saveSetting("last_sync", now)
        self.settings:flush()
        self:mirrorToLinkss()
        if self.settings:isTrue("use_sleep_screen") then
            self:applyKoreaderSleepScreen(false)
        end
        if show_result then
            self:showMessage(_("Token on Kindle dashboard updated."), 2)
        end
    else
        os.remove(temporary_file)
        self.last_error = tostring(status or code or response_headers or _("Unknown download error"))
        logger.warn("TokenOnKindle: refresh failed:", self.last_error)
        if show_result then
            self:showMessage(
                _("Token on Kindle refresh failed:") .. "\n" .. self.last_error
            )
        end
    end

    self.syncing = false
end

function TokenOnKindle:syncNow(show_result, may_connect)
    if NetworkMgr:isConnected() then
        self:downloadDashboard(show_result)
    elseif may_connect then
        NetworkMgr:runWhenConnected(function()
            self:downloadDashboard(show_result)
        end)
    elseif show_result then
        self:showMessage(_("Wi-Fi is not connected."), 2)
    end
end

function TokenOnKindle:editUrl()
    local dialog
    dialog = InputDialog:new{
        title = _("Token on Kindle dashboard URL"),
        input = self:getUrl(),
        input_hint = "http://192.168.x.x:8765/dashboard.png",
        description = _("Use the dashboard.png URL shown by the desktop app. A local-network URL is supported; Internet access is not required."),
        buttons = {
            {
                {
                    text = _("Cancel"),
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        local value = dialog:getInputText()
                        value = value and value:gsub("%s+$", "") or ""
                        if value:match("^https?://") then
                            self.settings:saveSetting("url", value)
                            self.settings:flush()
                            self:syncHelperConfig()
                            UIManager:close(dialog)
                            UIManager:nextTick(function()
                                self:syncNow(true, true)
                            end)
                        else
                            self:showMessage(_("Please enter an http:// or https:// URL."))
                        end
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function TokenOnKindle:setInterval(minutes)
    self.settings:saveSetting("interval_minutes", minutes)
    self.settings:flush()
    self:syncHelperConfig()
end

function TokenOnKindle:setKoreaderSleepScreenEnabled(enabled)
    if enabled then
        if self:applyKoreaderSleepScreen(true) then
            self.settings:makeTrue("use_sleep_screen")
        end
    else
        self.settings:makeFalse("use_sleep_screen")
        self:showMessage(_("Token on Kindle will no longer change KOReader's sleep-screen setting."), 2)
    end
    self.settings:flush()
end

function TokenOnKindle:setBackgroundRefreshEnabled(enabled)
    if enabled then
        if not isFile(HELPER_ENABLE) then
            self:showMessage(_("The Kindle background helper is not installed. Install the Token on Kindle Kindle-helper package first."))
            return
        end
        self:syncHelperConfig()
        local result = os.execute("/bin/sh " .. HELPER_ENABLE .. " >/dev/null 2>&1")
        if result == 0 then
            self:showMessage(_("Sleep refresh enabled."), 2)
        else
            self:showMessage(_("Could not enable the Kindle sleep-refresh helper."))
        end
    else
        if isFile(HELPER_DISABLE) then
            os.execute("/bin/sh " .. HELPER_DISABLE .. " >/dev/null 2>&1")
        else
            os.remove(BACKGROUND_FLAG)
        end
        self:showMessage(_("Sleep refresh disabled."), 2)
    end
end

function TokenOnKindle:isBackgroundRefreshEnabled()
    return isFile(BACKGROUND_FLAG)
end

function TokenOnKindle:isBackgroundRefreshRunning()
    return processIsAlive(readTextFile(HELPER_PID))
end

function TokenOnKindle:getStatusText()
    local last_sync = self.settings:readSetting("last_sync")
    local sync_text = last_sync and os.date("%Y-%m-%d %H:%M:%S", last_sync) or _("Never")
    local helper_installed = isFile(HELPER_ENABLE)
    local helper_running = self:isBackgroundRefreshRunning()
    local linkss_status = isDirectory(LINKSS_DIR) and _("available") or _("not found")
    local screensaver_status = Device:supportsScreensaver() and _("supported") or _("not available")

    return table.concat({
        _("URL:") .. "\n" .. (self:getUrl() ~= "" and self:getUrl() or _("Not configured")),
        "",
        _("Cached image:") .. "\n" .. OUTPUT_FILE,
        "",
        _("Last successful refresh:") .. " " .. sync_text,
        _("Refresh interval:") .. " " .. tostring(self:getIntervalMinutes()) .. " " .. _("minutes"),
        _("KOReader sleep screen:") .. " " .. screensaver_status,
        _("Kindle helper:") .. " " .. (helper_installed and _("installed") or _("not installed")),
        _("Sleep refresh:") .. " " .. (self:isBackgroundRefreshEnabled() and _("enabled") or _("disabled")),
        _("Scheduler:") .. " " .. (helper_running and _("running") or _("stopped")),
        _("linkss:") .. " " .. linkss_status,
        _("Helper log:") .. "\n" .. HELPER_LOG,
        self.last_error and ("\n" .. _("Last error:") .. " " .. self.last_error) or "",
    }, "\n")
end

function TokenOnKindle:onResume()
    if self:getUrl() ~= "" then
        UIManager:nextTick(function()
            self:syncNow(false, false)
        end)
    end
end

function TokenOnKindle:onNetworkConnected()
    if self:getUrl() ~= "" then
        UIManager:nextTick(function()
            self:syncNow(false, false)
        end)
    end
end

function TokenOnKindle:onSuspend()
    -- The KOReader event loop stops while the Kindle is suspended. The optional
    -- Kindle helper owns RTC wakeups and network refreshes during that period.
end

function TokenOnKindle:addToMainMenu(menu_items)
    menu_items.token_on_kindle = {
        text = _("Token on Kindle"),
        sorting_hint = "more_tools",
        sub_item_table = {
            {
                text = _("Refresh dashboard now"),
                keep_menu_open = true,
                callback = function()
                    self:syncNow(true, true)
                end,
            },
            {
                text = _("Set dashboard URL"),
                keep_menu_open = true,
                callback = function()
                    self:editUrl()
                end,
            },
            {
                text = _("Use as KOReader sleep screen"),
                keep_menu_open = true,
                checked_func = function()
                    return self.settings:isTrue("use_sleep_screen")
                end,
                callback = function()
                    self:setKoreaderSleepScreenEnabled(
                        not self.settings:isTrue("use_sleep_screen")
                    )
                end,
            },
            {
                text = _("Refresh while Kindle sleeps"),
                keep_menu_open = true,
                enabled_func = function()
                    return isFile(HELPER_ENABLE) or self:isBackgroundRefreshEnabled()
                end,
                checked_func = function()
                    return self:isBackgroundRefreshEnabled()
                end,
                callback = function()
                    self:setBackgroundRefreshEnabled(
                        not self:isBackgroundRefreshEnabled()
                    )
                end,
            },
            {
                text = _("Refresh interval"),
                sub_item_table = {
                    {
                        text = _("10 minutes"),
                        checked_func = function() return self:getIntervalMinutes() == 10 end,
                        callback = function() self:setInterval(10) end,
                    },
                    {
                        text = _("30 minutes"),
                        checked_func = function() return self:getIntervalMinutes() == 30 end,
                        callback = function() self:setInterval(30) end,
                    },
                    {
                        text = _("60 minutes"),
                        checked_func = function() return self:getIntervalMinutes() == 60 end,
                        callback = function() self:setInterval(60) end,
                    },
                },
            },
            {
                text = _("Status"),
                keep_menu_open = true,
                callback = function()
                    self:showMessage(self:getStatusText())
                end,
            },
        },
    }
end

return TokenOnKindle
