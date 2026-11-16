local function sendWorkshopEvent(event, callback)
    local endpoint = GetConvar('paradise_webhook_url', '')
    local workshopKey = GetConvar('paradise_workshop_key', '')
    local function finish(ok, status)
        if callback then callback(ok, status) end
    end
    if not endpoint:match('^https://') or workshopKey == '' then
        print('[paradise_customs_webhook] Missing webhook configuration.')
        finish(false, 0)
        return
    end
    local body = json.encode(event)
    local headers = {
        ['Content-Type'] = 'application/json',
        ['X-Workshop-Key'] = workshopKey,
    }
    local function attempt(number)
        PerformHttpRequest(endpoint, function(status)
            if status == 200 or status == 201 then
                finish(true, status)
            elseif number < 5 and (status <= 0 or status == 429 or status >= 500) then
                SetTimeout(1000 * (2 ^ (number - 1)), function() attempt(number + 1) end)
            else
                print(('[paradise_customs_webhook] Event %s failed (HTTP %d).'):format(tostring(event.eventId), status))
                finish(false, status)
            end
        end, 'POST', body, headers, { followLocation = false })
    end
    attempt(1)
end

exports('SendWorkshopEvent', sendWorkshopEvent)
