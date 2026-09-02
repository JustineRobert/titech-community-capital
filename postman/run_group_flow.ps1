param(
  [string]$BaseUrl = 'http://localhost:5000',
  [string]$Name = 'Local Dev',
  [string]$Email = 'dev@example.com',
  [string]$Password = 'Password123!',
  [string]$GroupName = 'Automated Created Group'
)

Write-Host "Using BaseUrl: $BaseUrl"

try {
  Write-Host "=== Registering user ($Email) ==="
  $registerBody = @{ name = $Name; email = $Email; password = $Password } | ConvertTo-Json
  $reg = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/register" -Body $registerBody -ContentType 'application/json' -ErrorAction Stop
  $token = $reg.token
  Write-Host "Registered. Token received (truncated):" ($token.Substring(0,40) + '...')
} catch {
  Write-Warning "Register failed (maybe user exists). Attempting login..."
}

if (-not $token) {
  Write-Host "=== Logging in ($Email) ==="
  $loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
  $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -Body $loginBody -ContentType 'application/json' -ErrorAction Stop
  $token = $login.token
  Write-Host "Login successful. Token received (truncated):" ($token.Substring(0,40) + '...')
}

if (-not $token) {
  Write-Error "Could not obtain token. Exiting."
  exit 1
}

Write-Host "=== Creating group: $GroupName ==="
$groupBody = @{ name = $GroupName; description = 'Created by automated script' } | ConvertTo-Json
$headers = @{ Authorization = "Bearer $token" }
$create = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/groups" -Body $groupBody -ContentType 'application/json' -Headers $headers -ErrorAction Stop

Write-Host "Group created: " ($create.data.id -or $create.data._id -or $create.data.id)
Write-Host "Full response:"
$create | ConvertTo-Json -Depth 5 | Write-Host

Write-Host "Done. If you want to join later, use the returned group ID with the join endpoint."
