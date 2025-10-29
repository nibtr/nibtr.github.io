+++
title = 'raycasting'
publishedDate = 2025-07-24T10:09:21+07:00
draft = false
repo = 'https://github.com/nibtr/raycasting'
demo = 'https://nibtr.github.io/raycasting/'
description = 'A simple raycasting renderer using Javascript canvas.'
+++

A simple raycasting rendering in Wolfenstein-style using vanilla JS canvas APIs. The project is a proof of concept for future similar ideas (e.g. games, although unsure).

![s8Wmt-HB](https://github.com/user-attachments/assets/79473e8c-6fef-4a8a-9ba0-856f096cb601)

>[!WARNING]
>- Since it is simply rendered on HTML canvas, poor performance on old machines and browsers are expected. (I'll adjust this in the future)
>- This might still be buggy and not used for anything serious, only for educational purposes.
>- Some logic might not be best practice.

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

The casting is implemented using DDA (Digital Differential Analyzer) algorithm to detect collision points between the rays and the walls. The algorithm works well in a tile-based world.

## References

The renderer is heavily inspired by [https://lodev.org/cgtutor/raycasting.html](https://lodev.org/cgtutor/raycasting.html) with some minor adjustments.
