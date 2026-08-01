local DataStorage = require("datastorage")
local FFIUtil = require("ffi/util")
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

local DEFAULT_URL = "http://192.168.1.2:8765/dashboard.png"
local DEFAULT_INTERVAL_MINUTES = 10
local LINKSS_DIR = "/mnt/us/linkss/screensavers"

local TokenOnKindle = WidgetContainer:extend{
    name = "token_on_kindle",
    settings = nil,
    output_dir = nil,
    output_file = nil,
    scheduled_task = nil,
    syncing = false,
    last_sync = nil,
    last_error = nil,
}

local function ensureDirectory(path)
    if lfs.attributes(path, "mode") == "directory" then
        return true
    end
    return lfs.mkdir(path) ~= nil
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

function TokenOnKindle:init()
    self.ui.menu:registerToMainMenu(self)

    self.settings = LuaSettings:open(
        DataStorage:getSettingsDir() .. "/token_on_kindle.lua"
    )

    local screensaver_root = DataStorage:getFullDataDir() .. "/screensavers"
    ensureDirectory(screensaver_root)
    self.output_dir = screensaver_root .. "/token-on-kindle"
    ensureDirectory(self.output_dir)
    self.output_file = self.output_dir .. "/dashboard.png"

    if self.settings:hasNot("url") then
        self.settings:saveSetting("url", DEFAULT_URL)
    end
    if self.settings:hasNot("interval_minutes") then
        self.settings:saveSetting("interval_minutes", DEFAULT_INTERVAL_MINUTES)
    end
    if self.settings:hasNot("auto_sync") then
        self.settings:makeTrue("auto_sync")
    end
    if self.settings:hasNot("mirror_linkss") then
        self.settings:makeFalse("mirror_linkss")
    end
    self.settings:flush()

    if self.settings:isTrue("auto_sync") then
        self:scheduleNextSync(2)
    end
end

function TokenOnKindle:getUrl()
    return self.settings:readSetting("url", DEFAULT_URL)
end

function TokenOnKindle:getIntervalSeconds()
    local minutes = tonumber(self.settings:readSetting(
        "interval_minutes",
        DEFAULT_INTERVAL_MINUTES
    )) or DEFAULT_INTERVAL_MINUTES
    return math.max(1, minutes) * 60
end

function TokenOnKindle:showMessage(message, timeout)
    UIManager:show(InfoMessage:new{
        text = message,
        timeout = timeout,
    })
end

function TokenOnKindle:copyToLinkss()
    if not self.settings:isTrue("mirror_linkss") then
        return true
    end
    if lfs.attributes(LINKSS_DIR, "mode") ~= "directory" then
        return nil, _("linkss screensaver folder was not found.")
    end

    local target = LINKSS_DIR .. "/token-on-kindle.png"
    -- KOReader's ffi.util.copyFile returns nil on success and an error string
    -- on failure; it is not a boolean-returning function.
    local copy_error = FFIUtil.copyFile(self.output_file, target)
    if copy_error then
        return nil, _("Could not copy the dashboard to linkss.")
            .. "\n" .. tostring(copy_error)
    end
    return true
end

function TokenOnKindle:downloadDashboard(show_result)
    if self.syncing then
        if show_result then
            self:showMessage(_("A Token on Kindle sync is already running."), 2)
        end
        return
    end

    self.syncing = true
    local temporary_file = self.output_file .. ".part"
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
    local ok, code, _, status = http.request{
        url = self:getUrl(),
        sink = ltn12.sink.file(file),
        redirect = true,
        headers = {
            ["Cache-Control"] = "no-cache",
            ["User-Agent"] = "KOReader Token-on-Kindle/0.1",
        },
    }

    local success = ok ~= nil and tonumber(code) == 200
    if success and not isPng(temporary_file) then
        success = false
        status = _("The downloaded file is not a PNG image.")
    end

    if success then
        os.remove(self.output_file)
        local renamed, rename_error = os.rename(temporary_file, self.output_file)
        if not renamed then
            success = false
            status = tostring(rename_error)
        end
    end

    if success then
        local mirrored, mirror_error = self:copyToLinkss()
        if not mirrored then
            success = false
            status = mirror_error
        end
    end

    if success then
        self.last_sync = os.time()
        self.last_error = nil
        self.settings:saveSetting("last_sync", self.last_sync)
        self.settings:flush()
        if show_result then
            self:showMessage(_("Token on Kindle dashboard updated."), 2)
        end
    else
        os.remove(temporary_file)
        self.last_error = tostring(status or code or _("Unknown download error"))
        logger.warn("TokenOnKindle: sync failed:", self.last_error)
        if show_result then
            self:showMessage(
                _("Token on Kindle sync failed:") .. "\n" .. self.last_error
            )
        end
    end

    self.syncing = false
end

function TokenOnKindle:syncNow(show_result)
    NetworkMgr:runWhenOnline(function()
        self:downloadDashboard(show_result)
    end)
end

function TokenOnKindle:cancelScheduledSync()
    if self.scheduled_task then
        UIManager:unschedule(self.scheduled_task)
        self.scheduled_task = nil
    end
end

function TokenOnKindle:scheduleNextSync(delay_seconds)
    self:cancelScheduledSync()
    if not self.settings:isTrue("auto_sync") then
        return
    end

    self.scheduled_task = function()
        self.scheduled_task = nil
        self:syncNow(false)
        self:scheduleNextSync(self:getIntervalSeconds())
    end
    UIManager:scheduleIn(delay_seconds or self:getIntervalSeconds(), self.scheduled_task)
end

function TokenOnKindle:configureKoreaderSleepScreen()
    G_reader_settings:saveSetting("screensaver_type", "random_image")
    G_reader_settings:saveSetting("screensaver_dir", self.output_dir)
    G_reader_settings:saveSetting("screensaver_img_background", "black")
    G_reader_settings:makeFalse("screensaver_show_message")
    G_reader_settings:makeFalse("screensaver_rotate_auto_for_best_fit")
    G_reader_settings:makeFalse("screensaver_stretch_images")
    G_reader_settings:flush()

    self:showMessage(
        _("KOReader's sleep screen now uses the Token on Kindle image."),
        3
    )
end

function TokenOnKindle:editUrl()
    local dialog
    dialog = InputDialog:new{
        title = _("Token on Kindle image URL"),
        input = self:getUrl(),
        input_hint = "http://192.168.x.x:8765/dashboard.png",
        description = _("Use the URL shown by the desktop Token on Kindle app. The computer and Kindle must be on the same local network."),
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
                        if value and value:match("^https?://") then
                            self.settings:saveSetting("url", value)
                            self.settings:flush()
                            UIManager:close(dialog)
                            self:syncNow(true)
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
    self:scheduleNextSync(1)
end

function TokenOnKindle:getStatusText()
    local last_sync = self.settings:readSetting("last_sync")
    local sync_text = _("Never")
    if last_sync then
        sync_text = os.date("%Y-%m-%d %H:%M:%S", last_sync)
    end

    local linkss_status = lfs.attributes(LINKSS_DIR, "mode") == "directory"
        and _("available") or _("not found")

    return table.concat({
        _("URL:") .. "\n" .. self:getUrl(),
        "",
        _("Cached image:") .. "\n" .. self.output_file,
        "",
        _("Last successful sync:") .. " " .. sync_text,
        _("Auto sync:") .. " " .. (self.settings:isTrue("auto_sync") and _("on") or _("off")),
        _("Interval:") .. " " .. tostring(self.settings:readSetting("interval_minutes", DEFAULT_INTERVAL_MINUTES)) .. " " .. _("minutes"),
        _("linkss:") .. " " .. linkss_status,
        self.last_error and ("\n" .. _("Last error:") .. " " .. self.last_error) or "",
    }, "\n")
end

function TokenOnKindle:onResume()
    if self.settings:isTrue("auto_sync") then
        self:scheduleNextSync(2)
    end
end

function TokenOnKindle:onNetworkConnected()
    if self.settings:isTrue("auto_sync") then
        self:scheduleNextSync(1)
    end
end

function TokenOnKindle:onSuspend()
    -- Never start Wi-Fi or a blocking download while the device is suspending.
    -- KOReader will use the last complete, atomically replaced dashboard image.
end

function TokenOnKindle:onClose()
    self:cancelScheduledSync()
end

function TokenOnKindle:addToMainMenu(menu_items)
    menu_items.token_on_kindle = {
        text = _("Token on Kindle"),
        sub_item_table = {
            {
                text = _("Sync dashboard now"),
                keep_menu_open = true,
                callback = function()
                    self:syncNow(true)
                end,
            },
            {
                text = _("Set image URL"),
                keep_menu_open = true,
                callback = function()
                    self:editUrl()
                end,
            },
            {
                text = _("Use as KOReader sleep screen"),
                keep_menu_open = true,
                callback = function()
                    self:configureKoreaderSleepScreen()
                end,
            },
            {
                text = _("Automatic sync"),
                keep_menu_open = true,
                checked_func = function()
                    return self.settings:isTrue("auto_sync")
                end,
                callback = function()
                    self.settings:toggle("auto_sync")
                    self.settings:flush()
                    if self.settings:isTrue("auto_sync") then
                        self:scheduleNextSync(1)
                    else
                        self:cancelScheduledSync()
                    end
                end,
            },
            {
                text = _("Sync interval"),
                sub_item_table = {
                    {
                        text = _("10 minutes"),
                        checked_func = function()
                            return self.settings:readSetting("interval_minutes") == 10
                        end,
                        callback = function() self:setInterval(10) end,
                    },
                    {
                        text = _("30 minutes"),
                        checked_func = function()
                            return self.settings:readSetting("interval_minutes") == 30
                        end,
                        callback = function() self:setInterval(30) end,
                    },
                    {
                        text = _("60 minutes"),
                        checked_func = function()
                            return self.settings:readSetting("interval_minutes") == 60
                        end,
                        callback = function() self:setInterval(60) end,
                    },
                },
            },
            {
                text = _("Mirror to Kindle linkss"),
                enabled_func = function()
                    return lfs.attributes(LINKSS_DIR, "mode") == "directory"
                end,
                checked_func = function()
                    return self.settings:isTrue("mirror_linkss")
                end,
                callback = function()
                    self.settings:toggle("mirror_linkss")
                    self.settings:flush()
                    if self.settings:isTrue("mirror_linkss") and isPng(self.output_file) then
                        local ok, error_message = self:copyToLinkss()
                        if not ok then self:showMessage(error_message) end
                    end
                end,
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
