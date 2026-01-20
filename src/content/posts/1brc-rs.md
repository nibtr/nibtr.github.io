+++
title = '1 Billion Row Challenge in Rust: How I went from 160s to 2.4s'
date = 2026-01-19T08:13:01+07:00
draft = false
+++

A while back I was looking for something to code on while learning Rust and I
came across the [1 Billion Row
Challenge](https://github.com/gunnarmorling/1brc). It's a fun little
optimization challenge that I thought would be a good exercise to get
some more experience with Rust, as well as to learn more about low level
programming.

Started from the humble **160s** of execution time, I was able to bring it
down to **2.4s**, which is roughly a **66.7x** speedup! But hey the numbers only
tell part of the story, I believe the real treasure is the learning and debugging
along the way.

This article is a summary of the 12 solutions I wrote in Rust, each is an
improvement on the previous one. We'll start off with a simple and naive
solution and work our way up gradually to more complex solutions.

Here's the rundown:

1. [naive and simple](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v1.rs)
2. [using a hashmap initialized with capacity](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v2.rs)
3. [lazy string allocation in hashmap keys](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v3.rs)
4. [using `Vec<u8>` instead of `String` for keys + unchecked UTF-8
   parsing](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v4.rs)
5. [parse temperatures as integers](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v5.rs)
6. [better hashing: using fnv1a](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v6.rs)
7. [mmap](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v7.rs)
8. [memchr](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v8.rs)
9. [unroll temperature parsing](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v9.rs)
10. [better hashing, use vec and manual collision detection instead of HashMap](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v10.rs)
11. [multithreading](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v11.rs)
12. [inline name + some better optimizations](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v12.rs)

I will be using a lot of `unwrap()` and `expect()` for simplicity, and 
also unsafe code to get even more speed, but I will make sure to explain
why it's necessary and how the constraints of the challenge allow us to do so.

*Disclaimer:* I am by no means an expert in Rust, so I might have made
mistakes in the code. The quality of the code is as bad as it can be and
is not portable across platforms except for unix-like systems.
Nonetheless, I hope it's still useful to someone.

If you just want to see the results, skip to the [benchmarks](#benchmarks).

## The challenge

The 1 billion row challenge is very simple: given a CSV file of 1
billion rows, each row has a structure of `city;temperature`:

```csv
Hamburg;12.0
Bulawayo;8.9
Palembang;38.8
St. John's;15.2
Cracow;12.6
```

The program should print out the min, mean, and max values per station,
alphabetically ordered like so:

```text
{Abha=5.0/18.0/27.4, Abidjan=15.7/26.0/34.1, Abéché=12.1/29.4/35.6, Accra=14.7/26.4/33.1, Addis Ababa=2.1/16.0/24.3, Adelaide=4.1/17.3/29.7, ...}
```

The goal is to write a program that runs as fast as possible, with some
constraints:

- No external dependencies
- Input value ranges are as follows:
  - Station name: non null UTF-8 string of min length 1 character and
  max length 100 bytes (i.e. this could be 100 one-byte characters, or
  50 two-byte characters, etc.).
  - Temperature value: non null double between -99.9 (inclusive) and
  99.9 (inclusive), always with one fractional digit.
- There is a maximum of 10,000 unique station names.

## System specs

All measurements are done on a machine with the following specs:

- OS: Linux x86_64 - 6.12 kernel
- CPU: AMD Ryzen 5 7600 (12 cores) measured at ~4.5-4.7 GHz
- RAM: 32 GB DDR5
- Storage: A pretty fast SSD

## Profiling, then optimizing

When you need to optimize something, and don't know where to start, profiling
should be your first step.

On Linux, `perf` is one of the best tools to use, has many features and
is straight out of the box. I will be using it to analyze the stats of
the whole program, giving me insights into low-level CPU counters.

```bash
# analyze the stats
perf stat -e branches,branch-misses,cache-references,cache-misses,cycles,instructions,idle-cycles-backend,idle-cycles-frontend,task-clock -- <program>
```

Do note that this is also my first time using `perf`, so there are
things that I don't fully understand yet. But most of the time, it's
pretty straightforward.

## Optimization 0: build configuration

The solutions will be compiled in release mode, with the following
configuration:

```toml
[profile.release]
codegen-units = 1
lto = "fat"
panic = "abort"
debug = true
```

Here's a great [reference](https://nnethercote.github.io/perf-book/build-configuration.html)
on the different options.

## Optimization 1: naive and simple idiomatic Rust

As with any iterative process, the first thing I did was to write a very
simple solution to make sure that I manage to get the results correctly.

I will be using a `BufReader` to read the input file line by line, split
the row at `;` and parse the temperature value as a `f64`. Then use
a `BTreeMap` to store the min, max, and mean values per station name,
the keys are automatically sorted alphabetically.

```rust
let f = File::open("data/measurements.txt").expect("file should exist");
let f = BufReader::new(f);

// (min, max, sum, count)
let mut stats: BTreeMap<String, (f64, f64, f64, usize)> = BTreeMap::new();

for line in f.lines().map_while(Result::ok) {
    let (station, temperature) = line.split_once(";").expect("delimiter should be ;");
    let temperature = temperature
        .parse::<f64>()
        .expect("should be a valid floating point");

    let stats = stats
        .entry(station.to_string())
        .or_insert((f64::MAX, f64::MIN, 0.0, 0));

    stats.0 = stats.0.min(temperature);
    stats.1 = stats.1.max(temperature);
    stats.2 += temperature;
    stats.3 += 1;
}

let mut stats = stats.into_iter().peekable();

print!("{{");
while let Some((station, (min, max, sum, count))) = stats.next() {
    print!("{station}={min}/{:.1}/{max}", sum / (count as f64));
    if stats.peek().is_some() {
        print!(", ");
    }
}
print!("}}")
```

It is as simple as it gets, but as you might have guessed, it's not very
efficient. This solution takes around **160s** to finish.

## Optimization 2: using a HashMap initialized with capacity

Although `BTreeMap` helps with sorting the keys, it's not efficient when
you have to insert a lot of elements in a hot loop since it has to
rebalance the tree every time. Well, we could use a `HashMap` for this. A
hash map is similar to a btree map, but it doesn't sort the keys so we
gain more performance. 

`HashMap` under the hood uses a `Vec`, so to reduce the number of times on
reallocation and copying, I also initialized the HashMap with a capacity of 10_000,
which is the maximum number of entries we expect to have.

Then at the end of the program, I converted the HashMap back to a BTreeMap
and print the results. This won't affect the performance that much because
now we will only have 10_000 unique entries to deal with.

All this is just a simple change to the code:

```rust
// (min, max, sum, count)
let mut stats: HashMap<String, (f64, f64, f64, usize)> = HashMap::with_capacity(10_000);

// ... same code as before

// convert to BTreeMap to sort the keys
let stats = BTreeMap::from_iter(stats);
let mut stats = stats.into_iter().peekable();

print!("{{");
while let Some((station, (min, max, sum, count))) = stats.next() {
    print!("{station}={min}/{:.1}/{max}", sum / (count as f64));
    if stats.peek().is_some() {
        print!(", ");
    }
}
print!("}}")
```

Just by changing the data structure I'm now down to `~85s`, which is a
`~1.87x` speedup from the naive optimization. Not bad, right?

## Optimization 3: lazy string allocation in HashMap keys

Looking at this line:

```rust
let stats = stats
    .entry(station.to_string())
    .or_insert((f64::MAX, f64::MIN, 0.0, 0));
```

We are doing memory allocation with `station.to_string()` every time we
need to check for the keys (for insertion AND for lookup). This is
wasteful because for lookup, we can actually compare the
`String` and `&str` directly. This will save us a lot of unnecessary
allocations.

```rust
// station is a &str
let (station, temperature) = line.split_once(";").expect("delimiter should be ;");
// ...
let stats = match stats.get_mut(station) {
        Some(stats) => stats,
        None => stats
            .entry(station.to_string())
            .or_insert((f64::MAX, f64::MIN, 0.0, 0)),
    };
```

When splitting the row by `;`, the `station` we get back is already a `&str`.
We can just use it directly for key lookup, and only allocate a new `String`
for the key when we need to insert a new value.

This change saved me `~12s` and brought the total time down to `~73s`,
with a `~2.18x` speedup.

## Optimization 4: using `Vec<u8>` instead of `String` for keys + unchecked UTF-8 parsing

One of the constraints confirm that all temperature values are valid UTF-8,
this allows us to bypass some of the checks when parsing because we know
the data is guaranteed to be valid UTF-8.

Also, since we don't plan on using any `String` APIs, we can just store
the station names as `Vec<u8>` instead to avoid unnecessary overheads.

Let's do them one by one:

```rust
// change the keys to Vec<u8>
let mut stats: HashMap<Vec<u8>, (f64, f64, f64, usize)> = HashMap::with_capacity(10_000);

// now when looping over the rows, we can split by `\n` instead
for line in f.split(b'\n').map_while(Result::ok) {
    let mut fields = line.splitn(2, |c| *c == b';');
    let station = fields.next().unwrap();
    let temperature = fields.next().unwrap();
    let temperature: f64 = unsafe { std::str::from_utf8_unchecked(temperature) }
      .parse()
      .unwrap();

    let stats = match stats.get_mut(station) {
      Some(stats) => stats,
      None => stats
          .entry(station.to_vec())
          .or_insert((f64::MAX, f64::MIN, 0.0, 0)),
    };
// ...
}
let stats = BTreeMap::from_iter(
    stats
        .into_iter()
        .map(|(station, stats)| (unsafe { String::from_utf8_unchecked(station) }, stats)),
);
// ...
```

Ooh, `unsafe`! But don't worry, it's totally fine here because we know
the temperature we're parsing is guaranteed to be valid UTF-8, the same
goes for station names. So `std::str::from_utf8_unchecked` and
`String::from_utf8_unchecked` are actually safe to use and are much faster.
We still need to do `station.to_vec()` to get a `Vec<u8>` though.

Now it's down to `~59s` with a `~2.7x` speedup.

## Optimization 5: Parse temperatures as integers

Here's a really neat trick I learned: you can actually parse the
temperatures as integers and only when printing do we need to parse them
as floats.

Storing numbers as integers (more specifically as `i32`) is faster since the CPU
instruction for addition is simpler, and as a result, we can save some CPU cycles
when doing the calculations.

```rust
// (min, max, sum, count)
let mut stats: HashMap<Vec<u8>, (i32, i32, i32, usize)> = HashMap::with_capacity(10_000);
//...
for line in f.split(b'\n').map_while(Result::ok) {
    let mut fields = line.splitn(2, |c| *c == b';');
    let station = fields.next().unwrap();
    let temperature = fields.next().unwrap();
    let temperature = parse_temperature(temperature);
// ...
}

print!("{{");
while let Some((station, (min, max, sum, count))) = stats.next() {
    print!(
        "{station}={:.1}/{:.1}/{:.1}",
        min as f64 / 10.0,
        sum as f64 / 10.0 / count as f64,
        max as f64 / 10.0
    );
    if stats.peek().is_some() {
        print!(", ");
    }
}
print!("}}")

// ...

fn parse_temperature(t: &[u8]) -> i32 {
    let mut signed = 1;
    let mut n = 0;
    for &b in t {
        match b {
            b'-' => signed = -1,
            b'.' => {}
            _ => n = n * 10 + (b - b'0') as i32,
        }
    }
    signed * n
}
```

The idea is very simple: we loop the bytes of the temperature, check for
different cases and update the `n` variable accordingly. Then we return the
result. E.g. if the temperature is `-12.3`, we will get `-123`. Then
when printing, we can divide the value by 10 to get the actual float.

Now it's down to `~55s`, that saves us around `4s`. Not much but it's
still a win. Looking at the `perf` stats:

```text
# Before optimization

155,022,922,709      branches:u                       #    2.650 G/sec                       (85.71%)
  2,914,220,481      branch-misses:u                  #    1.88% of all branches             (85.71%)
  4,909,470,169      cache-references:u               #   83.934 M/sec                       (85.72%)
    777,445,559      cache-misses:u                   #   15.84% of all cache refs           (85.71%)
287,486,850,000      cycles:u                         #    4.915 GHz                         (85.71%)
836,204,231,606      instructions:u                   #    2.91  insn per cycle

# After optimization

144,474,015,086      branches:u                       #    2.639 G/sec                       (85.72%)
  2,746,280,655      branch-misses:u                  #    1.90% of all branches             (85.71%)
  4,352,618,794      cache-references:u               #   79.511 M/sec                       (85.72%)
    555,749,482      cache-misses:u                   #   12.77% of all cache refs           (85.71%)
268,545,581,519      cycles:u                         #    4.906 GHz                         (85.72%)
768,534,700,580      instructions:u                   #    2.86  insn per cycle
```

You can see that there are **~7%** fewer cycles and **~8%** fewer instructions,
pretty good!.

## Optimization 6: Better hashing: using FNV-1a

The [Rust doc](https://doc.rust-lang.org/std/collections/struct.HashMap.html)
for `HashMap` says:

> By default, HashMap uses a hashing algorithm selected to provide
resistance against HashDoS attacks...
The default hashing algorithm is currently SipHash 1-3, though this is
subject to change at any point in the future. While its performance is
very competitive for medium sized keys, other hashing algorithms will
outperform it for small keys such as integers as well as large keys such
as long strings, though those algorithms will typically not protect
against attacks such as HashDoS.

tl;dr: The default algorithm is still fast, but it needs to do more work
for security reasons. For this challenge, security is not really a concern,
so opting for other non-cryptographic algorithms is fine. I then opted for
[FNV-1a](https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function#FNV-1a_hash),
which is an algorithm that I can technically implement myself. I can go
for `ahash` or `xxhash` crates, but that is against the rule of not
using external dependencies.

First I need to actually build the hasher, which is pretty simple:

```rust
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

struct Fnv1aHasher {
    hash: u64,
}

impl Default for Fnv1aHasher {
    fn default() -> Self {
        Self {
            hash: FNV_OFFSET_BASIS,
        }
    }
}

impl Hasher for Fnv1aHasher {
    #[inline(always)]
    fn finish(&self) -> u64 {
        self.hash
    }

    #[inline(always)]
    fn write(&mut self, bytes: &[u8]) {
        let mut h = self.hash;
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
        self.hash = h;
    }
}

struct Fnv1aHashBuilder;
impl BuildHasher for Fnv1aHashBuilder {
    type Hasher = Fnv1aHasher;

    fn build_hasher(&self) -> Self::Hasher {
        Fnv1aHasher::default()
    }
}
```

then use it like so, with everything else should be the same:

```rust
let mut stats: HashMap<Vec<u8>, (i32, i32, i32, usize), Fnv1aHashBuilder> =
    HashMap::with_capacity_and_hasher(10_000, Fnv1aHashBuilder);
```

The new hasher gets me down from `~55s` to `~51s`. The improvement is
small, but for a simple hash algorithm like FNV-1a, that's good enough.
The fact that it's so easy to implement is already a win for me :).

## Optimization 7: mmap

Now we're getting into the fun part.

[mmap](https://en.wikipedia.org/wiki/Mmap) is a new concept for me at
the time of doing the challenge, and since everyone went for this
approach, I decided to try it out.

Basically, `mmap` lets the operating system map the file directly into
the virtual memory space so I can treat it like a large byte array in
memory. It also avoids the cost of extra copies from the kernel to an
in-memory buffer and instead accesses the kernel's page cache directly.
In a hot loop like what we're doing, this can be a huge performance boost.

In Rust, `memmap2` is a crate that provides a simple API to use `mmap`.
But since I'm not allowed to use any external dependencies, I had to
manually copy a small part of the code from the crate (this is fine
right? :D).

```rust
unsafe fn mmap(f: File) -> Result<&'static [u8], io::Error> {
    let len = f.metadata()?.len();

    unsafe {
        let ptr = libc::mmap(
            std::ptr::null_mut(),
            len as libc::size_t,
            libc::PROT_READ,
            libc::MAP_PRIVATE,
            f.as_raw_fd(),
            0,
        );

        if ptr == libc::MAP_FAILED {
            Err(io::Error::last_os_error())
        } else {
            if libc::madvise(ptr, len as libc::size_t, libc::MADV_SEQUENTIAL) != 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(std::slice::from_raw_parts(ptr as *const u8, len as usize))
            }
        }
    }
}
```

But wait, `libc`? Isn't that a dependency? It is, but I think it's a
necessary dependency if we want to use `mmap`. Besides, `std` uses `libc`
internally.

`libc::mmap()` is inherently unsafe, but that's not a problem here because the
file is read-only, never mutated, and mapped for the entire duration of
the program. Furthermore, because we're reading the file sequentially, with
`madvise(MADV_SEQUENTIAL)`, we can also explicitly hint to the kernel
that the access pattern is sequential, further improving the performance by
fetching more data from the disk. I know I should have used `libc::munmap()` to
unmap the file, but I wanted to keep the code as simple as possible.

Now we just need to use it like so:

```rust
let f = File::open("data/measurements.txt").expect("file should exist");
let f = unsafe { mmap(f).unwrap() };
// ...
```

and change how we split the `\n`:

```rust
for line in f.split(|c| *c == b'\n') {
    // this is needed for case we're at the end of the file
    if line.is_empty() {
        continue;
    }
    // ...
}
```

The new `mmap` approach brought the total time down to `~33.5s` with a
`~4.76x` speedup from the very first optimization. That's a huge win!

## Optimization 8: memchr

Using `libc::mmap()` gives us essentially “parallel I/O” because the kernel
handles read-ahead automatically. On top of that, we can speed up parsing
by using `libc::memchr()` to find `\n` and `;` instead of doing a `.split()` on the slice.
Under the hood, `libc::memchr()` is highly optimized at the CPU level,
utilizing [SIMD](https://en.wikipedia.org/wiki/Single_instruction,_multiple_data)
when possible and scans memory much faster than a typical Rust iterator or string split.

I still don't understand much about SIMD, but the key idea is that the CPU can process multiple
bytes at once instead of one at a time.

With `memchr`, because it returns a pointer to the first occurrence of
the byte we want, we need to adjust how we handle the loop logic:

```rust
let mut at = 0;
loop {
    let rest = &map[at..];
    let nl_ptr = unsafe {
        libc::memchr(
            rest.as_ptr() as *const libc::c_void,
            b'\n' as libc::c_int,
            rest.len(),
        )
    };

    let line = if nl_ptr.is_null() {
        rest
    } else {
        /// SAFETY: same contiguous memory as `rest`
        let len = unsafe { (nl_ptr as *const u8).offset_from(rest.as_ptr()) } as usize;
        &rest[..len]
    };

    at += line.len() + 1;

    if line.is_empty() {
        break;
    }

    let semicolon_ptr = unsafe {
        libc::memchr(
            line.as_ptr() as *const libc::c_void,
            b';' as libc::c_int,
            line.len(),
        )
    };
    let semicolon_pos = if semicolon_ptr.is_null() {
        continue; // skip malformed lines
    } else {
        unsafe { (semicolon_ptr as *const u8).offset_from(line.as_ptr()) as usize }
    };

    let station = &line[..semicolon_pos];
    let temperature = &line[(semicolon_pos + 1)..];
    let temperature = parse_temperature(temperature);

    let stats = match stats.get_mut(station) {
        Some(stats) => stats,
        None => stats
            .entry(station.to_vec())
            .or_insert((i32::MAX, i32::MIN, 0, 0)),
    };

    stats.0 = stats.0.min(temperature);
    stats.1 = stats.1.max(temperature);
    stats.2 += temperature;
    stats.3 += 1;
}

// ...
```

We use unsafe here because `libc::memchr` and pointer arithmetic can’t
be checked by Rust, but it’s safe in our code because:
- `mmap` slice covers the entire file, so pointers are valid.
- We never write to memory, only read.
- All pointer arithmetic stays within bounds.
- The scan is strictly forward, so no underflow or dangling pointers.

We're now at `~25.4s` with a `~6.3x` speedup from the naive
optimization.

## Optimization 9: Unroll temperature parsing

Currently, I'm doing a loop when parsing the temperature:

```rust
fn parse_temperature(t: &[u8]) -> i32 {
    // rule states that file is valid floating point with 1 decimal place
    let mut signed = 1;
    let mut n = 0;
    for &b in t {
        match b {
            b'-' => signed = -1,
            b'.' => {}
            _ => n = n * 10 + (b - b'0') as i32,
        }
    }
    signed * n
}
```

But since the constraint confirms that a floating value is guaranteed to
have the format `[-]DD.D` or `[-]D.D`, with 1 decimal place, we can
actually ignore (unroll) the loop entirely and just do manual
increments:

```rust
#[inline(always)]
fn parse_temperature(t: &[u8]) -> i32 {
    let mut neg = 1;
    let mut i = 0;
    if t[i] == b'-' {
        i += 1;
        neg = -1;
    }

    let mut n = (t[i] - b'0') as i32;
    i += 1;

    if t[i] != b'.' {
        n = n * 10 + (t[i] - b'0') as i32;
        i += 1;
    }

    i += 1; // skip .
    n = n * 10 + (t[i] - b'0') as i32;
    neg * n
}
```



## Benchmarks
