local current_key = KEYS[1]
local previous_key = KEYS[2]

local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local current_window_start = tonumber(ARGV[4])

local current_count =
    tonumber(redis.call("GET", current_key)) or 0

local previous_count =
    tonumber(redis.call("GET", previous_key)) or 0

local elapsed =
    now - current_window_start

local progress =
    elapsed / window_ms

local previous_contribution =
    previous_count * (1 - progress)

local estimated_count =
    previous_contribution + current_count

-- Request rejected
if estimated_count >= limit then

    local remaining =
        math.max(0, math.floor(limit - estimated_count))

    local reset_ms =
        window_ms - elapsed

    return {
        0,
        current_count,
        previous_count,
        math.floor(estimated_count),
        remaining,
        reset_ms
    }
end

-- Request allowed
current_count =
    redis.call("INCR", current_key)

redis.call(
    "PEXPIRE",
    current_key,
    window_ms * 2
)

local new_estimated_count =
    estimated_count + 1

local remaining =
    math.max(
        0,
        math.floor(limit - new_estimated_count)
    )

local reset_ms =
    window_ms - elapsed

return {
    1,
    current_count,
    previous_count,
    math.floor(new_estimated_count),
    remaining,
    reset_ms
}