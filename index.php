<?php
declare(strict_types=1);

$root = __DIR__;
$port = 3210;
$origin = "http://127.0.0.1:$port";
$log = dirname($root) . "/logs/next.log";
$node = "/opt/plesk/node/24/bin";

function portOpen(int $port): bool
{
    $socket = @fsockopen("127.0.0.1", $port, $errno, $error, 0.3);
    if (!$socket) {
        return false;
    }
    fclose($socket);
    return true;
}

if (!portOpen($port)) {
    if (!is_dir($root . "/node_modules/next") || !is_dir($root . "/.next")) {
        http_response_code(503);
        header("Content-Type: text/plain; charset=utf-8");
        echo "CodeCapture démarre. Recharge la page dans une minute.";
        exit;
    }
    $command = "cd " . escapeshellarg($root)
        . " && PATH=" . $node . ":\$PATH nohup " . $node . "/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p " . $port
        . " > " . escapeshellarg($log) . " 2>&1 &";
    shell_exec($command);
    for ($try = 0; $try < 40 && !portOpen($port); $try++) {
        usleep(250000);
    }
}

$uri = $_SERVER["REQUEST_URI"] ?? "/";
$publicHost = preg_replace("/:\d+$/", "", $_SERVER["HTTP_HOST"] ?? "codecapture.wstr.fr");
$handle = curl_init($origin . $uri);
$method = $_SERVER["REQUEST_METHOD"] ?? "GET";
$headers = [];
if (function_exists("getallheaders")) {
    foreach (getallheaders() as $name => $value) {
        $lower = strtolower($name);
        if (in_array($lower, ["host", "content-length", "connection", "accept-encoding"], true)) {
            continue;
        }
        $headers[] = "$name: $value";
    }
}
$headers[] = "Host: $publicHost";
$headers[] = "X-Forwarded-Host: $publicHost";
$headers[] = "X-Forwarded-Proto: https";
$headers[] = "X-Forwarded-For: " . ($_SERVER["REMOTE_ADDR"] ?? "127.0.0.1");
curl_setopt_array($handle, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_HTTPHEADER => $headers,
]);
if ($method === "HEAD") {
    curl_setopt($handle, CURLOPT_NOBODY, true);
}
if (!in_array($method, ["GET", "HEAD"], true)) {
    curl_setopt($handle, CURLOPT_POSTFIELDS, file_get_contents("php://input") ?: "");
}
$response = curl_exec($handle);
if ($response === false) {
    http_response_code(502);
    header("Content-Type: text/plain; charset=utf-8");
    echo "L'application n'a pas répondu.";
    exit;
}
$status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
$headerSize = (int) curl_getinfo($handle, CURLINFO_HEADER_SIZE);
curl_close($handle);
http_response_code($status > 0 ? $status : 502);
foreach (preg_split("/\r\n|\n|\r/", substr($response, 0, $headerSize)) as $line) {
    if ($line === "" || str_starts_with($line, "HTTP/")) {
        continue;
    }
    $lower = strtolower($line);
    if (str_starts_with($lower, "transfer-encoding:") || str_starts_with($lower, "content-length:") || str_starts_with($lower, "connection:")) {
        continue;
    }
    if (str_starts_with($lower, "location:")) {
        $line = preg_replace("#https?://(127\\.0\\.0\\.1|localhost)(:\\d+)?#i", "https://$publicHost", $line) ?? $line;
    }
    header($line, false);
}
echo substr($response, $headerSize);
