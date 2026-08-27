local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local _ = require("gettext")

local DEFAULT_URL = "http://192.168.1.2:8765/dashboard.png"
local DEFAULT_INTERVAL_MINUTES = 10
local DATA_DIR = "/mnt/us/token-on-kindle"
local OUTPUT_FILE = DATA_DIR .. "/dashboard.png"
local CONFIG_FILE = DATA_DIR .. "/config.sh"
local LINKSS_DIR = "/mnt/us/linkss/screensavers"
local LINKSS_FILE = LINKSS_DIR .. "/bg_xsmall_ss00.png"
local PID_FILE = "/tmp/token-on-kindle-helper.pid"

local TokenOnKindle = WidgetContainer:extend{
    name = "token_on_kindle",
    is_doc_only = false,
    settings = nil,
}

local function ensureDirectory(path)
    if lfs.attributes(path, "mode") == "directory" then
        return true
    end
    return lfs.mkdir(path) ~= nil
end

local function shellQuote(value)
    return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function isPng(path)
    local file = io.open(path, "rb")
    if not file then
        return false
    end
    local signature = file:read(8)
    file:close()
    return signature == "\137PNG\13\10\26\10"
end

function TokenOnKindle:init()
    self.ui.menu:registerToMainMenu(self)

    self.settings = LuaSettings:open(
        DataStorage:getSettingsDir() .. "/token_on_kindle.lua"
    )

    if self.settings:hasNot("url") then
        self.settings:saveSetting("url", DEFAULT_URL)
    end
    if self.settings:hasNot("interval_minutes") then
        self.settings:saveSetting("interval_minutes", DEFAULT_INTERVAL_MINUTES)
    end
    if self.settings:hasNot("background_enabled") then
        self.settings:makeFalse("background_enabled")
    end
    self.settings:flush()

    ensureDirectory(DATA_DIR)
    self:writeHelperConfig()

    if Device:isKindle() and self.settings:isTrue("background_enabled") then
        self:startHelper(false)
    end
end

function TokenOnKindle:getUrl()
    return self.settings:readSetting("url", DEFAULT_URL)
end

function TokenOnKindle:isConfigured()
    local url = self:getUrl()
    return type(url) == "string"
        and url ~= ""
        and url ~= DEFAULT_URL
        and url:match("^https?://") ~= nil
end

function TokenOnKindle:getIntervalMinutes()
    local minutes = tonumber(self.settings:readSetting(
        "interval_minutes",
        DEFAULT_INTERVAL_MINUTES
    )) or DEFAULT_INTERVAL_MINUTES
    return math.max(1, math.floor(minutes))
end

function TokenOnKindle:getHelperPath()
    return self.path .. "/bin/helper.sh"
end

function TokenOnKindle:showMessage(message, timeout)
    UIManager:show(InfoMessage:new{
        text = message,
        timeout = timeout,
    })
end

function TokenOnKindle:writeHelperConfig()
    ensureDirectory(DATA_DIR)
    local file = io.open(CONFIG_FILE .. ".tmp", "w")
    if not file then
        return false
    end

    local url = self:isConfigured() and self:getUrl() or ""
    file:write("IMAGE_URL=", shellQuote(url), "\n")
    file:write("INTERVAL_SECONDS=", tostring(self:getIntervalMinutes() * 60), "\n")
    file:write("OUTPUT_FILE=", shellQuote(OUTPUT_FILE), "\n")
    file:write("LINKSS_FILE=", shellQuote(LINKSS_FILE), "\n")
    file:write("NETWORK_TIMEOUT=25\n")
    file:close()

    return os.rename(CONFIG_FILE .. ".tmp", CONFIG_FILE) ~= nil
end

function TokenOnKindle:runHelper(action)
    if not Device:isKindle() then
        return false
    end
    local helper = self:getHelperPath()
    if lfs.attributes(helper, "mode") ~= "file" then
        return false
    end
    self:writeHelperConfig()
    local command = "/bin/sh " .. shellQuote(helper) .. " " .. shellQuote(action)
    return os.execute(command) == 0
end

function TokenOnKindle:helperRunning()
    local file = io.open(PID_FILE, "r")
    if not file then
        return false
    end
    local pid = tonumber(file:read("*l"))
    file:close()
    if not pid then
        return false
    end
    return os.execute("kill -0 " .. tostring(pid) .. " >/dev/null 2>&1") == 0
end

function TokenOnKindle:startHelper(show_result)
    if not self:isConfigured() then
        if show_result then
            self:showMessage(_("Set the dashboard URL first."))
        end
        return false
    end
    local ok = self:runHelper("start")
    if show_result then
        self:showMessage(ok
            and _("Background updater started.")
            or _("Could not start the background updater."), 2)
    end
    return ok
end

function TokenOnKindle:stopHelper(show_result)
    local ok = self:runHelper("stop")
    if show_result then
        self:showMessage(ok
            and _("Background updater stopped.")
            or _("Could not stop the background updater."), 2)
    end
    return ok
end

function TokenOnKindle:configureKoreaderSleepScreen(show_result)
    if not Device:isKindle() or not Device:supportsScreensaver() then
        if show_result then
            self:showMessage(_("This Kindle cannot use KOReader's custom sleep screen."))
        end
        return false
    end

    G_reader_settings:saveSetting("screensaver_type", "document_cover")
    G_reader_settings:saveSetting("screensaver_document_cover", OUTPUT_FILE)
    G_reader_settings:saveSetting("screensaver_img_background", "black")
    G_reader_settings:makeFalse("screensaver_show_message")
    G_reader_settings:flush()

    if show_result then
        self:showMessage(_("Token on Kindle is now the KOReader sleep screen."), 3)
    end
    return true
end

function TokenOnKindle:syncNow(show_result)
    if not self:isConfigured() then
        if show_result then
            self:showMessage(_("Set the dashboard URL first."))
        end
        return false
    end

    local progress
    if show_result then
        progress = InfoMessage:new{ text = _("Updating Token on Kindle…") }
        UIManager:show(progress)
        UIManager:forceRePaint()
    end

    local ok = self:runHelper("once")

    if progress then
        UIManager:close(progress)
    end

    if ok and isPng(OUTPUT_FILE) then
        self.settings:saveSetting("last_sync", os.time())
        self.settings:flush()
        self:configureKoreaderSleepScreen(false)
        if show_result then
            local mirrored = lfs.attributes(LINKSS_DIR, "mode") == "directory"
            self:showMessage(
                mirrored
                    and _("Dashboard updated; KOReader and linkss now use the new image.")
                    or _("Dashboard updated; KOReader now uses the new image."),
                3
            )
        end
        return true
    end

    if show_result then
        self:showMessage(_("Dashboard update failed. Check the URL, Wi-Fi, and helper log."))
    end
    return false
end

function TokenOnKindle:editUrl()
    local dialog
    dialog = InputDialog:new{
        title = _("Token on Kindle image URL"),
        input = self:getUrl(),
        input_hint = "http://192.168.x.x:8765/dashboard.png",
        description = _("Use the dashboard.png URL shown by the desktop app."),
        save_callback = function(value, closing)
            if not value or not value:match("^https?://") then
                return false, _("Please enter an http:// or https:// URL.")
            end

            self.settings:saveSetting("url", value)
            self.settings:makeTrue("background_enabled")
            self.settings:flush()
            self:writeHelperConfig()
            self:startHelper(false)

            if closing then
                UIManager:nextTick(function()
                    self:syncNow(true)
                end)
            end
            return true, _("URL saved.")
        end,
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function TokenOnKindle:setInterval(minutes)
    self.settings:saveSetting("interval_minutes", minutes)
    self.settings:flush()
    self:writeHelperConfig()
    if self.settings:isTrue("background_enabled") then
        self:runHelper("restart")
    end
end

function TokenOnKindle:getStatusText()
    local last_sync = self.settings:readSetting("last_sync")
    local sync_text = last_sync and os.date("%Y-%m-%d %H:%M:%S", last_sync) or _("Never")
    local linkss = lfs.attributes(LINKSS_DIR, "mode") == "directory"
        and _("available") or _("not found")
    local screensaver = Device:isKindle() and Device:supportsScreensaver()
        and _("supported") or _("not supported")
    local helper = self:helperRunning() and _("running") or _("stopped")

    return table.concat({
        _("URL:") .. "\n" .. self:getUrl(),
        "",
        _("Cached image:") .. "\n" .. OUTPUT_FILE,
        "",
        _("KOReader sleep screen:") .. " " .. screensaver,
        _("linkss mirror:") .. " " .. linkss,
        _("Background helper:") .. " " .. helper,
        _("Interval:") .. " " .. tostring(self:getIntervalMinutes()) .. " " .. _("minutes"),
        _("Last manual sync:") .. " " .. sync_text,
    }, "\n")
end

function TokenOnKindle:onResume()
    if Device:isKindle() and self.settings:isTrue("background_enabled") then
        self:startHelper(false)
    end
end

function TokenOnKindle:addToMainMenu(menu_items)
    menu_items.token_on_kindle = {
        text = _("Token on Kindle"),
        sorting_hint = "more_tools",
        sub_item_table = {
            {
                text = _("Update dashboard now"),
                callback = function()
                    self:syncNow(true)
                end,
            },
            {
                text = _("Set dashboard URL"),
                callback = function()
                    self:editUrl()
                end,
            },
            {
                text = _("Use as KOReader sleep screen"),
                callback = function()
                    self:configureKoreaderSleepScreen(true)
                end,
            },
            {
                text = _("Background updates during sleep"),
                checked_func = function()
                    return self.settings:isTrue("background_enabled")
                end,
                callback = function()
                    self.settings:toggle("background_enabled")
                    self.settings:flush()
                    if self.settings:isTrue("background_enabled") then
                        self:startHelper(true)
                    else
                        self:stopHelper(true)
                    end
                end,
            },
            {
                text = _("Update interval"),
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
                callback = function()
                    self:showMessage(self:getStatusText())
                end,
            },
        },
    }
end

return TokenOnKindle
