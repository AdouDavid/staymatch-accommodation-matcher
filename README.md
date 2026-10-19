# StayMatch Accommodation Matcher

A responsive student housing matcher app that helps students discover homes based on budget, distance, and facilities.

## Features

- Search and filter listings by price and distance
- Compare up to three listings side by side
- Personalized recommendations using weighted preferences
- Responsive, modern interface with light/dark mode and scroll animations

## Tech stack

- Python + Flask
- SQLite
- Pandas
- HTML, CSS, JavaScript

## Run locally

1. Create a virtual environment
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the app:
   ```bash
   python app.py
   ```
4. Open http://127.0.0.1:5000/

## Project structure

- `app.py` - Flask application and API routes
- `templates/` - HTML templates
- `static/` - CSS and JavaScript assets
- `student_housing.db` - local SQLite database
