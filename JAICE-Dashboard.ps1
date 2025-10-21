# JAICE Dashboard - Single Startup Script
# This script handles everything: cleanup, startup, and management

# Set window title and hide console
$Host.UI.RawUI.WindowTitle = "JAICE Dashboard"
Add-Type -AssemblyName System.Windows.Forms

# Function to show notification
function Show-Notification {
    param($Title, $Message, $Icon = "Information")
    [System.Windows.Forms.MessageBox]::Show($Message, $Title, "OK", $Icon)
}

# Function to check if servers are running
function Test-ServersRunning {
    $backend = Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue
    $frontend = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    return ($backend -and $frontend)
}

# Function to stop all servers
function Stop-AllServers {
    Write-Host "Stopping existing servers..." -ForegroundColor Yellow
    try {
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
        Write-Host "Servers stopped" -ForegroundColor Green
    } catch {
        Write-Host "No servers to stop" -ForegroundColor Blue
    }
}

# Function to start servers
function Start-Servers {
    Write-Host "Starting JAICE Dashboard servers..." -ForegroundColor Green
    
    # Check if we're in the right directory
    if (-not (Test-Path "server\server.mjs")) {
        Show-Notification "Error" "server\server.mjs not found. Please run this script from the JAICE Dashboard root directory." "Error"
        exit 1
    }
    
    # Start backend server
    Write-Host "Starting backend server..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd" -ArgumentList "/c", "cd server && node server.mjs" -WindowStyle Hidden
    
    # Wait for backend
    Start-Sleep -Seconds 3
    
    # Start frontend server
    Write-Host "Starting frontend server..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd" -ArgumentList "/c", "npm run start:frontend" -WindowStyle Hidden
    
    # Wait for frontend
    Start-Sleep -Seconds 5
    
    # Check if servers started successfully
    if (Test-ServersRunning) {
        Write-Host "JAICE Dashboard is running!" -ForegroundColor Green
        Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
        Write-Host "Backend: http://localhost:3005" -ForegroundColor Cyan
        
        # Open browser
        Start-Process "http://localhost:5173"
        
        Show-Notification "JAICE Dashboard" "Dashboard started successfully!`nFrontend: http://localhost:5173`nBackend: http://localhost:3005" "Information"
    } else {
        Show-Notification "Error" "Failed to start servers. Please check the console for errors." "Error"
    }
}

# Main execution
try {
    # Stop any existing servers
    Stop-AllServers
    
    # Start fresh servers
    Start-Servers
    
    # Keep script running to monitor servers
    Write-Host "`nPress Ctrl+C to stop all servers and exit" -ForegroundColor Yellow
    Write-Host "Dashboard will continue running in the background..." -ForegroundColor Blue
    
    # Monitor loop
    while ($true) {
        Start-Sleep -Seconds 10
        
        if (-not (Test-ServersRunning)) {
            Write-Host "Servers stopped unexpectedly" -ForegroundColor Red
            break
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Show-Notification "JAICE Dashboard Error" $_.Exception.Message "Error"
} finally {
    # Cleanup on exit
    Write-Host "`nStopping all servers..." -ForegroundColor Yellow
    Stop-AllServers
    Write-Host "JAICE Dashboard stopped" -ForegroundColor Green
}


