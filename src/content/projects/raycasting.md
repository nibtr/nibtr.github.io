+++
title = 'raycasting'
publishedDate = 2025-07-24T10:09:21+07:00
draft = false
repo = 'https://github.com/nibtr/raycasting'
demo = 'https://nibtr.github.io/raycasting/'
description = 'A simple raycasting renderer using Javascript canvas.'
+++

A simple raycasting renderer in Wolfenstein-style using vanilla JS canvas APIs. The project is a proof of concept for
future similar ideas (e.g. games, although I'm not sure).

![s8Wmt-HB](https://github.com/user-attachments/assets/79473e8c-6fef-4a8a-9ba0-856f096cb601)

>- Since it is simply rendered on HTML canvas, poor performance on old machines and browsers are expected.
>- This might still be buggy and not used for anything serious, only for educational purposes.

The demo has 2 screens:

- The left one is a 2d top-down view of the world, demonstrating how the rays are casted and how they interact with the
walls.
- The right one is a pseudo-3d view, depicting how the same scene appears from the player’s perspective.

## Local development

Ensure `npm` or `python3` is installed and run the following to open a local HTTP server

```bash
npx http-server /path/to/project -o -p 6969
# or
python3 -m http.server
```

## Control

W: forward; S: backward; A,D: rotate

## Implementation

The casting is implemented using DDA (Digital Differential Analyzer) algorithm to detect collision points between the
rays and the walls. The algorithm works well in a tile-based world.

The renderer is heavily inspired by [https://lodev.org/cgtutor/raycasting.html](https://lodev.org/cgtutor/raycasting.html)
(originally written in C) with some minor adjustments in order to port to JS.
