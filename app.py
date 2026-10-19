import sqlite3

import pandas as pd
from flask import Flask, jsonify, render_template, request

DATABASE = "student_housing.db"
MAX_REPORTS = 3  # a listing with this many reports is hidden

app = Flask(__name__)


# ---------- Database helpers ----------
def read(sql, params=()):
    """Run a SELECT and return a list of dictionaries (one per row)."""
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    rows = [dict(row) for row in con.execute(sql, params).fetchall()]
    con.close()
    return rows


def write(sql, params=()):
    """Run an INSERT/UPDATE, save it, and return the new row's id."""
    con = sqlite3.connect(DATABASE)
    cursor = con.execute(sql, params)
    con.commit()
    new_id = cursor.lastrowid
    con.close()
    return new_id


def create_table():
    write("""
        CREATE TABLE IF NOT EXISTS listings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT NOT NULL,
            address     TEXT NOT NULL,
            price       REAL NOT NULL,
            distance_km REAL NOT NULL,
            facilities  TEXT DEFAULT '',
            contact     TEXT DEFAULT '',
            reports     INTEGER DEFAULT 0
        )
    """)


# ---------- Small utilities ----------
def number_or_none(value):
    """Turn '80000' into 80000.0. Return None for empty or invalid input."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_list(text):
    """Turn 'WiFi, Water' into ['water', 'wifi'] (lowercase, no blanks, no duplicates)."""
    return sorted({item.strip().lower() for item in str(text or "").split(",") if item.strip()})


# ---------- Pages ----------
@app.route("/")
def home():
    return render_template("index.html")


# ---------- 1. Register a listing ----------
@app.route("/api/listings", methods=["POST"])
def add_listing():
    data = request.get_json()
    title = (data.get("title") or "").strip()
    address = (data.get("address") or "").strip()
    price = number_or_none(data.get("price"))
    distance = number_or_none(data.get("distance_km"))

    if not title or not address or price is None or distance is None or price < 0 or distance < 0:
        return jsonify(error="Fill in title, address, price and distance (numbers, not negative)."), 400

    new_id = write(
        "INSERT INTO listings (title, address, price, distance_km, facilities, contact) VALUES (?, ?, ?, ?, ?, ?)",
        (title, address, price, distance, ",".join(to_list(data.get("facilities"))), data.get("contact") or ""),
    )
    return jsonify(id=new_id), 201


# ---------- 2 + 3. Search by price and filter by distance ----------
@app.route("/api/listings", methods=["GET"])
def search_listings():
    min_price = number_or_none(request.args.get("min_price"))
    max_price = number_or_none(request.args.get("max_price"))
    max_distance = number_or_none(request.args.get("max_distance"))

    sql = "SELECT * FROM listings WHERE reports < ?"
    params = [MAX_REPORTS]
    if min_price is not None:
        sql += " AND price >= ?"
        params.append(min_price)
    if max_price is not None:
        sql += " AND price <= ?"
        params.append(max_price)
    if max_distance is not None:
        sql += " AND distance_km <= ?"
        params.append(max_distance)
    sql += " ORDER BY price"

    return jsonify(read(sql, params))


# ---------- 4. Compare facilities ----------
@app.route("/api/compare")
def compare():
    ids = [int(i) for i in request.args.get("ids", "").split(",") if i.isdigit()]
    if len(ids) < 2:
        return jsonify(error="Pick at least two listings to compare."), 400

    slots = ",".join("?" * len(ids))  # "?,?,?" - one placeholder per id
    listings = read(f"SELECT * FROM listings WHERE id IN ({slots}) AND reports < ?", ids + [MAX_REPORTS])
    for item in listings:
        item["facilities"] = to_list(item["facilities"])

    all_facilities = sorted({f for item in listings for f in item["facilities"]})
    return jsonify(listings=listings, facilities=all_facilities)


# ---------- 5. Rank by the student's preferences ----------
def lower_is_better(column):
    """Scale a column to 0-1 where the smallest value gets 1 and the largest gets 0."""
    spread = column.max() - column.min()
    if spread == 0:
        return 1.0
    return (column.max() - column) / spread


@app.route("/api/recommend", methods=["POST"])
def recommend():
    p = request.get_json()
    budget = number_or_none(p.get("budget"))
    max_distance = number_or_none(p.get("max_distance"))
    required = set(to_list(p.get("required")))
    preferred = set(to_list(p.get("preferred")))

    # Step 1: load visible listings into a Pandas table
    df = pd.DataFrame(read("SELECT * FROM listings WHERE reports < ?", (MAX_REPORTS,)))
    if df.empty:
        return jsonify([])

    # Step 2: remove listings that break a hard rule
    if budget is not None:
        df = df[df["price"] <= budget]
    if max_distance is not None:
        df = df[df["distance_km"] <= max_distance]
    if required:
        df = df[df["facilities"].apply(lambda text: required <= set(text.split(",")))]
    if df.empty:
        return jsonify([])

    # Step 3: give each remaining listing a score between 0 and 1 for each factor
    df = df.copy()
    df["price_score"] = lower_is_better(df["price"])
    df["distance_score"] = lower_is_better(df["distance_km"])
    if preferred:
        df["facility_score"] = df["facilities"].apply(lambda text: len(preferred & set(text.split(","))) / len(preferred))
    else:
        df["facility_score"] = 1.0

    # Step 4: combine the scores using the student's importance weights
    w_price = number_or_none(p.get("w_price")) or 0
    w_distance = number_or_none(p.get("w_distance")) or 0
    w_facilities = number_or_none(p.get("w_facilities")) or 0
    total = (w_price + w_distance + w_facilities) or 1
    df["score"] = (
        w_price * df["price_score"] + w_distance * df["distance_score"] + w_facilities * df["facility_score"]
    ) / total

    # Step 5: best first
    df = df.sort_values("score", ascending=False).round({"score": 3})
    return jsonify(df[["id", "title", "address", "price", "distance_km", "facilities", "score"]].to_dict("records"))


# ---------- 6. Report an outdated listing ----------
@app.route("/api/listings/<int:listing_id>/report", methods=["POST"])
def report_listing(listing_id):
    rows = read("SELECT reports FROM listings WHERE id = ?", (listing_id,))
    if not rows:
        return jsonify(error="Listing not found."), 404

    write("UPDATE listings SET reports = reports + 1 WHERE id = ?", (listing_id,))
    count = rows[0]["reports"] + 1
    return jsonify(reports=count, hidden=count >= MAX_REPORTS)


create_table()

# Seed a few realistic sample listings so the UI has meaningful content immediately.
if not read("SELECT 1 FROM listings LIMIT 1"):
    write(
        """
        INSERT INTO listings (title, address, price, distance_km, facilities, contact)
        VALUES
            (?, ?, ?, ?, ?, ?),
            (?, ?, ?, ?, ?, ?),
            (?, ?, ?, ?, ?, ?),
            (?, ?, ?, ?, ?, ?)
        """,
        (
            "Sunrise Compact Suite", "University Road, Nsukka", 420000, 1.8,
            "wifi,water,parking,security,study-room",
            "+234 812 000 0001",
            "Cedar Court Hostel", "Main Campus, Awka", 360000, 2.4,
            "wifi,water,generator,study-room",
            "+234 813 000 0002",
            "Oak Valley Residence", "Mgbowo Estate, Enugu", 510000, 3.2,
            "wifi,water,parking,gym,security",
            "+234 814 000 0003",
            "Greenfield Pods", "Ikeja Junction, Lagos", 580000, 4.6,
            "wifi,water,parking,generator,security",
            "+234 815 000 0004",
        ),
    )

if __name__ == "__main__":
    app.run(debug=True)
