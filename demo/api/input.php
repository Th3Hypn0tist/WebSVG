<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$inputDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'input';

if (!is_dir($inputDir)) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'demo/input directory not found',
        'json_files' => [],
        'svg_files' => []
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

$entries = scandir($inputDir);
if ($entries === false) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'failed to read demo/input',
        'json_files' => [],
        'svg_files' => []
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

$files = [];
foreach ($entries as $entry) {
    if ($entry === '.' || $entry === '..') {
        continue;
    }

    $path = $inputDir . DIRECTORY_SEPARATOR . $entry;
    if (is_file($path)) {
        $files[] = $entry;
    }
}

sort($files, SORT_NATURAL | SORT_FLAG_CASE);

$jsonFiles = array_values(array_filter(
    $files,
    static fn(string $name): bool => strtolower(pathinfo($name, PATHINFO_EXTENSION)) === 'json'
));

$svgFiles = array_values(array_filter(
    $files,
    static fn(string $name): bool => strtolower(pathinfo($name, PATHINFO_EXTENSION)) === 'svg'
));

if (count($jsonFiles) !== 1) {
    echo json_encode([
        'ok' => false,
        'error' => 'demo/input must contain exactly one JSON manifest',
        'json_files' => $jsonFiles,
        'svg_files' => $svgFiles,
        'files' => $files
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

echo json_encode([
    'ok' => true,
    'manifest' => $jsonFiles[0],
    'svg_files' => $svgFiles,
    'files' => $files
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
